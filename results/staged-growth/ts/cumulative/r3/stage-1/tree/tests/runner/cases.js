// Shipped into the agent's tree as the visible-test runner, so this file and
// caseRunner.ts may import only Node built-ins.
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
export const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const isStringRecord = (value) => isRecord(value) && Object.values(value).every((item) => typeof item === "string");
const isOptional = (value, guard) => value === undefined || guard(value);
const isString = (value) => typeof value === "string";
const isBoolean = (value) => typeof value === "boolean";
export const isExpectation = (value) => isRecord(value) &&
    typeof value.exitCode === "number" &&
    isOptional(value.stdout, isString) &&
    isOptional(value.stderrPrefixes, isStringList) &&
    isOptional(value.stderrNonEmpty, isBoolean);
export const isCase = (value) => isRecord(value) &&
    isString(value.id) &&
    isString(value.description) &&
    isStringList(value.args) &&
    isOptional(value.env, isStringRecord) &&
    isExpectation(value.expect);
export const isCaseFile = (value) => isRecord(value) && Array.isArray(value.cases) && value.cases.every(isCase);
const nonEmptyLines = (text) => text.split(/\r?\n/).filter((line) => line.length > 0);
const unmatchedPrefixes = (prefixes, lines) => {
    const remaining = [...lines];
    return prefixes.filter((prefix) => {
        const index = remaining.findIndex((line) => line.startsWith(prefix));
        if (index === -1)
            return true;
        remaining.splice(index, 1);
        return false;
    });
};
const stderrFailures = (expect, stderr) => {
    const lines = nonEmptyLines(stderr);
    const failures = [];
    if (expect.stderrNonEmpty === true && lines.length === 0)
        failures.push("expected a message on stderr");
    if (expect.stderrPrefixes === undefined)
        return failures;
    if (lines.length !== expect.stderrPrefixes.length) {
        failures.push(`expected ${expect.stderrPrefixes.length} stderr lines, got ${lines.length}`);
    }
    unmatchedPrefixes(expect.stderrPrefixes, lines).forEach((prefix) => failures.push(`no stderr line starts with "${prefix}"`));
    return failures;
};
export const judge = (testCase, observed) => {
    const { expect } = testCase;
    const failures = [];
    if (observed.timedOut)
        failures.push("timed out");
    if (observed.exitCode !== expect.exitCode)
        failures.push(`exit code ${observed.exitCode}, expected ${expect.exitCode}`);
    if (expect.stdout !== undefined && observed.stdout !== expect.stdout) {
        failures.push(`stdout differs\n--- expected\n${expect.stdout}--- actual\n${observed.stdout}`);
    }
    failures.push(...stderrFailures(expect, observed.stderr));
    return { id: testCase.id, passed: failures.length === 0, failures };
};
