import { Router, type Request } from 'express';
import {
  assertPeriod,
  buildStatement,
  getReportSettings,
  monthLabel,
  monthPeriod,
  saveReportSettings,
  type StatementKind,
} from '../analysis/statement.js';
import { buildStatementWorkbook } from '../analysis/statementExcel.js';
import { currentMoney } from '../currency/money.js';
import type { DbClient } from '../db/types.js';
import type { Period } from '../repositories/reportRepository.js';
import { HttpError } from './errors.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function param(req: Request, name: string): string {
  const value = req.query[name];
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string, name: string): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `Geçersiz tarih (${name}): YYYY-AA-GG biçiminde olmalı.`);
  }
  return value;
}

/**
 * Sorgu: kind=monthly&month=YYYY-AA · kind=daily&date=YYYY-AA-GG · kind=range&from=…&to=…
 */
export function readStatementQuery(req: Request): { kind: StatementKind; period: Period } {
  const kind = param(req, 'kind') as StatementKind;
  let period: Period;
  if (kind === 'monthly') {
    const month = param(req, 'month');
    if (!ISO_MONTH.test(month)) throw new HttpError(400, 'Geçersiz ay: YYYY-AA biçiminde olmalı.');
    period = monthPeriod(month);
  } else if (kind === 'daily') {
    const date = validDate(param(req, 'date'), 'date');
    period = { from: date, to: date };
  } else if (kind === 'range') {
    period = { from: validDate(param(req, 'from'), 'from'), to: validDate(param(req, 'to'), 'to') };
  } else {
    throw new HttpError(400, 'Geçersiz rapor türü: monthly, daily veya range olmalı.');
  }
  try {
    assertPeriod(period);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  return { kind, period };
}

/** Ekstre (aylık, Excel) ve raporlar (gün sonu / tarih aralığı, PDF-Word arayüzde), bildirim ayarları */
export function createStatementRouter(db: DbClient): Router {
  const router = Router();

  router.get('/statements', async (req, res) => {
    const { kind, period } = readStatementQuery(req);
    res.json({ ...(await buildStatement(db, kind, period)), currency: currentMoney().display });
  });

  router.get('/statements/export.xlsx', async (req, res) => {
    const { kind, period } = readStatementQuery(req);
    const currency = currentMoney().display;
    const statement = await buildStatement(db, kind, period);
    const name =
      kind === 'monthly'
        ? `Clario-ekstre-${period.from.slice(0, 7)}`
        : kind === 'daily'
          ? `Clario-gun-sonu-${period.from}`
          : `Clario-rapor-${period.from}_${period.to}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(await buildStatementWorkbook(statement, currency));
  });

  router.get('/statements/settings', async (_req, res) => {
    res.json(await getReportSettings(db));
  });

  router.put('/statements/settings', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hour = Number(body.dailyHour);
    if (typeof body.monthly !== 'boolean' || typeof body.daily !== 'boolean' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new HttpError(400, 'Geçersiz bildirim ayarı.');
    }
    const settings = { monthly: body.monthly, daily: body.daily, dailyHour: hour };
    await saveReportSettings(db, settings);
    res.json(settings);
  });

  return router;
}

export { monthLabel };
