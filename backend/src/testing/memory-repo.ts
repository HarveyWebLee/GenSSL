import { randomUUID } from 'node:crypto';

type EntityBase = { id: string; createdAt?: Date; updatedAt?: Date };

function matchesWhere<T extends EntityBase>(row: T, where: Record<string, unknown> | Record<string, unknown>[]): boolean {
  const clauses = Array.isArray(where) ? where : [where];
  return clauses.some((clause) =>
    Object.entries(clause).every(([key, value]) => (row as Record<string, unknown>)[key] === value),
  );
}

export function createMemoryRepository<T extends EntityBase>() {
  const items: T[] = [];

  const repo = {
    items,
    create(data: Partial<T>): T {
      return { ...(data as T) };
    },
    async save(entity: T | T[]): Promise<T | T[]> {
      const list = Array.isArray(entity) ? entity : [entity];
      const saved = list.map((item) => {
        if (!item.id) {
          item.id = randomUUID();
        }
        const now = new Date();
        item.createdAt = item.createdAt ?? now;
        item.updatedAt = now;
        const index = items.findIndex((row) => row.id === item.id);
        if (index >= 0) {
          items[index] = item;
        } else {
          items.push(item);
        }
        return item;
      });
      return Array.isArray(entity) ? saved : saved[0]!;
    },
    async find(options?: { where?: Record<string, unknown>; order?: Record<string, 'ASC' | 'DESC' | 'asc' | 'desc'>; select?: string[] | Record<string, boolean>; relations?: unknown }): Promise<T[]> {
      let rows = options?.where ? items.filter((row) => matchesWhere(row, options.where as Record<string, unknown>)) : [...items];
      const orderEntries = options?.order ? Object.entries(options.order) : [];
      if (orderEntries[0]) {
        const [key, direction] = orderEntries[0];
        const factor = String(direction).toUpperCase() === 'DESC' ? -1 : 1;
        rows = rows.sort((a, b) => {
          const left = (a as Record<string, unknown>)[key];
          const right = (b as Record<string, unknown>)[key];
          if (left instanceof Date && right instanceof Date) {
            return (left.getTime() - right.getTime()) * factor;
          }
          return String(left ?? '').localeCompare(String(right ?? '')) * factor;
        });
      }
      return rows;
    },
    async findOne(options: { where: Record<string, unknown> | Record<string, unknown>[] }): Promise<T | null> {
      return items.find((row) => matchesWhere(row, options.where)) ?? null;
    },
    async count(options?: { where?: Record<string, unknown> }): Promise<number> {
      if (!options?.where) {
        return items.length;
      }
      return items.filter((row) => matchesWhere(row, options.where as Record<string, unknown>)).length;
    },
    async remove(entity: T): Promise<T> {
      const index = items.findIndex((row) => row.id === entity.id);
      if (index >= 0) {
        items.splice(index, 1);
      }
      return entity;
    },
    createQueryBuilder(_alias?: string) {
      const state: { id?: string; addPrivate?: boolean } = {};
      return {
        addSelect() {
          state.addPrivate = true;
          return this;
        },
        where(_sql: string, params?: { id?: string }) {
          state.id = params?.id;
          return this;
        },
        async getOne(): Promise<T | null> {
          return items.find((row) => row.id === state.id) ?? null;
        },
      };
    },
  };

  return repo;
}
