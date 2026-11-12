import { fxFactor } from '../currency/money.js';
import type { DbClient } from '../db/types.js';

export interface ExpenseRow {
  expenseDate: string;
  category: string;
  amount: number;
}

/** [from, to] aralığındaki giderler (iki uç dahil); tutarlar gider gününün kuruyla çevrilir. */
export function getExpenses(db: DbClient, from: string, to: string): Promise<ExpenseRow[]> {
  return db.query<ExpenseRow>(
    `
    SELECT expense_date AS "expenseDate", category, amount * ${fxFactor('expense_date')} AS amount
    FROM expenses
    WHERE expense_date >= ? AND expense_date <= ?
    ORDER BY expense_date`,
    [from, to],
  );
}
