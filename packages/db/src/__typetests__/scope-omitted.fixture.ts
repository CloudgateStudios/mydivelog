// This file MUST NOT compile. scope.test.ts runs tsc against it and asserts
// each numbered violation below is rejected. If this file ever compiles
// cleanly, ownership scoping has stopped being enforced by the type system.
import { createDiveRepository } from '../repositories/dive.repository.ts';
import type { PrismaClient } from '../generated/client.ts';

const repo = createDiveRepository({} as PrismaClient);

// 1. Calling a repository method with no scope at all.
void repo.list();

// 2. Passing a bare user id where a UserScope is required.
void repo.findById('9f1c0e1a-0000-4000-8000-000000000000', 'dive-id');

// 3. Hand-rolling a scope-shaped object to bypass userScope().
void repo.count({ userId: '9f1c0e1a-0000-4000-8000-000000000000' });
