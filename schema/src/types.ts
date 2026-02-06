/**
 * Schema migration primitives.
 */

export type SqlStatement = string;

export interface Migration {
  id: string;
  description: string;
  statements: readonly SqlStatement[];
}
