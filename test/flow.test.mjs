import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const file = new URL('../flow.json', import.meta.url);
const source = readFileSync(file, 'utf8');
const nodes = JSON.parse(source);
const byName = (name) => nodes.find((node) => node.name === name);
const run = (name, message, values = {}) => {
    const execute = new Function('msg', 'env', byName(name).func);
    return execute(message, { get: (key) => values[key] });
};

const start = (payload) => run('Validate entry date', { payload })[0];
const date = '2026-11-18';
const entry = (id, duration_seconds, billable = true) => ({
    id,
    duration_seconds,
    billable,
});

function collect(message, data, total = data.length, statusCode = 200, headers = {}) {
    return run('Add durations and paginate', {
        ...message,
        statusCode,
        headers,
        payload: {
            data,
            meta: {
                current_page: message.report.page,
                per_page: 100,
                last_page: Math.max(1, Math.ceil(total / 100)),
                total,
            },
        },
    });
}

test('exports a formatted, manual flow with only core nodes and valid wiring', () => {
    assert.equal(source, JSON.stringify(nodes, null, 2) + '\n');
    const nodeIds = new Set(nodes.map(({ id }) => id));
    assert.equal(nodeIds.size, nodes.length);
    assert.deepEqual(
        [...new Set(nodes.map(({ type }) => type))].sort(),
        ['catch', 'comment', 'debug', 'function', 'http request', 'inject', 'tab'],
    );
    for (const node of nodes) {
        assert.ok((node.wires ?? []).flat().every((target) => nodeIds.has(target)));
    }
    const inject = byName('Select entry date');
    assert.equal(inject.once, false);
    assert.equal(inject.repeat, '');
    assert.equal(inject.crontab, '');
    assert.ok(nodes.filter(({ type }) => type === 'debug').every(
        ({ complete, console }) => complete === 'payload' && console === false,
    ));
});

test('rejects impossible dates and missing or malformed authorisation', () => {
    for (const invalid of ['2026-11-31', '2026-13-01', '2026-11-1', 20261118]) {
        assert.match(run('Validate entry date', { payload: invalid })[1].payload.error, /valid entry date/);
    }
    for (const auth of [undefined, 'missing-prefix', 'Bearer first\nsecond']) {
        assert.match(run('Prepare scoped request', start(date), {
            TIMELODGE_AUTHORIZATION: auth,
        })[1].payload.error, /TIMELODGE_AUTHORIZATION/);
    }
});

test('binds the request to TimeLodge and leaves the token in the HTTP node environment', () => {
    const [request] = run('Prepare scoped request', {
        ...start(date),
        url: 'https://example.test/',
        headers: { Authorization: 'wrong' },
    }, { TIMELODGE_AUTHORIZATION: 'Bearer synthetic-qa' });
    assert.equal(request.url, 'https://timelodge.com/api/v1/time-entries?entry_date=2026-11-18&page=1&per_page=100');
    assert.equal(request.followRedirects, false);
    assert.equal(request.requestTimeout, 10000);
    assert.equal(request.headers, undefined);
    assert.equal(request.payload, undefined);
    assert.deepEqual(byName('Read TimeLodge entries').headers[1], {
        keyType: 'other',
        keyValue: 'Authorization',
        valueType: 'other',
        valueValue: '${TIMELODGE_AUTHORIZATION}',
    });
});

test('summarises two pages and keeps independent runs independent', () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => entry(String(id), 20, id % 2 === 0));
    const [next, interim] = collect(start(date), firstPage, 101);
    assert.equal(interim, null);
    assert.equal(next.report.page, 2);
    assert.deepEqual(collect(next, [entry('100', 60)], 101)[1].payload, {
        entryDate: date,
        entryCount: 101,
        recordedSeconds: 2060,
        billableSeconds: 1060,
    });
    assert.deepEqual(collect(start('2026-11-17'), [])[1].payload, {
        entryDate: '2026-11-17',
        entryCount: 0,
        recordedSeconds: 0,
        billableSeconds: 0,
    });
});

test('fails closed on shifting pagination, excessive page count, duplicates and invalid records', () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => entry(String(id), 20));
    const [next] = collect(start(date), firstPage, 101);
    assert.match(collect(next, [entry('0', 30)], 101)[2].payload.error, /duplicate/);
    assert.match(collect(next, [entry('101', 30), entry('102', 30)], 102)[2].payload.error, /pagination/);
    assert.match(collect(start(date), firstPage, 10001)[2].payload.error, /10,000/);
    assert.match(collect(start(date), [entry('1', -1)])[2].payload.error, /invalid/);
});

test('reports authentication and rate errors without forwarding response data', () => {
    for (const status of [401, 403]) {
        const result = collect(start(date), [entry('private', 1)], 1, status);
        assert.equal(result[1], null);
        assert.match(result[2].payload.error, /denied access/);
        assert.equal(JSON.stringify(result).includes('private'), false);
    }
    const result = collect(start(date), [], 0, 429, { 'retry-after': '45' });
    assert.equal(result[2].payload.retryAfterSeconds, 45);
    assert.match(result[2].payload.error, /rate limit/);
    assert.equal(collect(start(date), [], 0, 302)[1], null);
});
