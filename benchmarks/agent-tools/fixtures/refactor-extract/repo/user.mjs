export function describe(user) {
  const name = `${user.last.toUpperCase()}, ${user.first}`;
  return `${name} (${user.age})`;
}
