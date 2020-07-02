import * as Joi from '@hapi/joi';
import * as probes from '../../probes';
import * as db from '../../db';
import * as P from 'bluebird';
import * as _ from 'lodash';
import { Message } from 'kafka-node';
import { validate, parse } from '../common';

interface AdvisorUpdate {
    host_id: string;
    issues: Array<string>;
}

const schema = Joi.object().keys({
    host_id: Joi.string().required(),
    issues: Joi.array().items(Joi.string()).required()
});

function parseMessage (message: Message): AdvisorUpdate | undefined {
    try {
        const parsed = parse(message);

        if (!parsed) {
            return;
        }

        return validate(parsed, schema);
    } catch (e) {
        probes.advisorUpdateErrorParse(message, e);
    }
}

export default async function onMessage (message: Message) {
    const knex = db.get();
    const parsed = parseMessage(message);
    if (!parsed) {
        return;
    }

    const { host_id, issues } = parsed;
    try {
        const pastIssues = await db.findHostIssues(knex, host_id);

        if (_.isEmpty(pastIssues)) {
            probes.advisorHostUnknown(host_id);
            return;
        }

        for (const issue of pastIssues) {
            if (_.find(issues, update => update === issue.issue_id)) {
                const result = await db.updateToUnresolved(knex, host_id, issue.issue_id);

                if (!_.isEmpty(result)) {
                    probes.advisorIssueUnknown(host_id, issue.issue_id);
                }
                probes.advisorUpdateSuccess(host_id, issue.issue_id, result.length);
            } else {
                const result = await db.updateToResolved(knex, host_id, issue.issue_id);
                
                if (!_.isEmpty(result)) {
                    probes.advisorIssueUnknown(host_id, issue.issue_id);
                }
                probes.advisorUpdateSuccess(host_id, issue.issue_id, result.length);
            }
        }
    } catch (e) {
        probes.advisorUpdateError(host_id, issues, e);
    }
}
