// pg_dump reparses CHECK expressions: BETWEEN can initially produce nested AND
// nodes which the reparse flattens. This deliberately small grammar only removes
// AND association. It never executes manifest text or guesses at other SQL syntax.
function conjunction(definition) {
  if (typeof definition !== 'string' || definition.length > 65536) return null;
  const tokens = [];
  // PostgreSQL's scanner only skips these ASCII whitespace characters. Unicode
  // spaces such as NBSP can belong to an unquoted identifier, so never use JS \s.
  const token = /[ \t\n\r\f\v]+|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+|>=|<=|<>|!=|[()=<>+-]/y;
  let offset = 0;
  while (offset < definition.length) {
    token.lastIndex = offset;
    const match = token.exec(definition);
    if (!match || tokens.length >= 4096) return null;
    offset = token.lastIndex;
    if (!/^[ \t\n\r\f\v]/.test(match[0])) tokens.push(match[0]);
  }
  let index = 0;
  const take = value => tokens[index] === value ? (++index, true) : false;
  function operand() {
    const value = tokens[index++];
    if (value === '+' || value === '-') {
      const number = tokens[index++];
      return /^[0-9]+$/.test(number ?? '') ? [value, number] : null;
    }
    if (value && (/^[0-9]+$/.test(value) || /^"/.test(value) || (/^[A-Za-z_][A-Za-z_0-9$]*$/.test(value) && !/^(CHECK|AND|OR|NOT)$/i.test(value)))) return [value];
    return null;
  }
  function terms(depth) {
    if (depth > 64) return null;
    const comparisons = [];
    do {
      if (take('(')) {
        const inner = terms(depth + 1);
        if (!inner || !take(')')) return null;
        comparisons.push(...inner);
      } else {
        const left = operand(), operator = tokens[index++], right = operand();
        if (!left || !/^(>=|<=|<>|!=|=|>|<)$/.test(operator ?? '') || !right) return null;
        comparisons.push([left, operator, right]);
      }
    } while (take('AND'));
    return comparisons;
  }
  if (!take('CHECK') || !take('(')) return null;
  const parsed = terms(0);
  return parsed && take(')') && index === tokens.length ? JSON.stringify(parsed) : null;
}

export function summariesMatch(actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
  if (!Array.isArray(actual?.constraints) || !Array.isArray(expected?.constraints) || actual.constraints.length !== expected.constraints.length) return false;
  const constraints = actual.constraints.map((constraint, index) => {
    const other = expected.constraints[index];
    // Only the corresponding CHECK may take the fallback; every metadata field
    // (including unknown fields), order and constraint count remain significant.
    if (constraint?.type !== 'c' || other?.type !== 'c' || constraint.definition === other.definition || JSON.stringify({...constraint, definition: null}) !== JSON.stringify({...other, definition: null})) return constraint;
    const normalized = conjunction(constraint.definition);
    if (normalized === null || normalized !== conjunction(other.definition)) return constraint;
    return {...constraint, definition: other.definition};
  });
  return JSON.stringify({...actual, constraints}) === JSON.stringify(expected);
}
