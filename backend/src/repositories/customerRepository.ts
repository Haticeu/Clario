import type { DbClient } from '../db/types.js';

export type CustomerType = 'Bayi' | 'Mağaza';

export interface CustomerRow {
  id: number;
  name: string;
  customerType: CustomerType;
  regionId: number;
  regionName: string;
  salesRepName: string | null;
}

export interface CustomerOrderDateRow {
  customerId: number;
  orderDate: string;
}

export function getCustomers(db: DbClient): Promise<CustomerRow[]> {
  return db.query<CustomerRow>(`
    SELECT c.id, c.name,
           c.customer_type AS "customerType",
           c.region_id AS "regionId",
           r.name AS "regionName",
           e.full_name AS "salesRepName"
    FROM customers c
    JOIN regions r ON r.id = c.region_id
    LEFT JOIN employees e ON e.id = c.sales_rep_id
    ORDER BY c.id`);
}

/**
 * Müşteri başına benzersiz sipariş günleri, kronolojik sırada. Sipariş ritmi ölçüldüğü
 * için iptal edilen siparişler de dahildir: iptal olsa bile müşteri sipariş vermiştir,
 * yani sessiz değildir.
 */
export function getCustomerOrderDates(db: DbClient, asOf: string): Promise<CustomerOrderDateRow[]> {
  return db.query<CustomerOrderDateRow>(
    `
    SELECT DISTINCT customer_id AS "customerId", order_date AS "orderDate"
    FROM orders
    WHERE order_date <= ?
    ORDER BY customer_id, order_date`,
    [asOf],
  );
}
