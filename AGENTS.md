## Coding patterns

- Treat most data like it is readonly: do not modify objects or arrays in place, instead make a copy of the data and modify the copy using patterns like object spread or array spread.
- If you need to modify data, make a copy of the data and modify the copy.
- If you need to modify data in a way that is not supported by the data structure, use patterns like object spread or array spread to modify the data.
- Try to use functional patterns like map, filter, etc (but not reduce, it is too complicated).
- Avoid using `let` or `var` to declare variables, instead use `const`.
- Avoid using `forEach` to iterate over or create arrays, instead use `map` or `filter`.
- Avoid complex ternary operators, instead use `if` statements.
- For more complex logic, use functions to encapsulate the logic, rather than using `let`.
- Avoid explicitly casting types with `as`, instead use type inference, and/or use `satisfies` to assert the type of the data.
