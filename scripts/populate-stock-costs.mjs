import { sql } from "./lib/sql.mjs";

async function main() {
  await sql(`
    UPDATE public.inventory_items
    SET
      purchase_unit = CASE
        WHEN lower(unit) LIKE '%ml%' THEN 'Botol'
        WHEN lower(unit) LIKE '%liter%' THEN 'Jerigen'
        WHEN lower(unit) LIKE '%roll%' THEN 'Pack'
        WHEN lower(unit) LIKE '%lembar%' THEN 'Box'
        ELSE 'Pcs'
      END,
      purchase_content_qty = CASE
        WHEN lower(unit) LIKE '%ml%' AND lower(item_name) LIKE '%coating%' THEN 50
        WHEN lower(unit) LIKE '%ml%' AND lower(item_name) LIKE '%menzerna%' THEN 1000
        WHEN lower(unit) LIKE '%ml%' THEN 500
        WHEN lower(unit) LIKE '%liter%' THEN 5
        WHEN lower(unit) LIKE '%lembar%' THEN 100
        WHEN lower(unit) LIKE '%roll%' THEN 5
        ELSE 1
      END,
      purchase_price = CASE
        WHEN lower(item_name) LIKE '%graphene%' OR lower(item_name) LIKE '%diamond%' THEN 750000
        WHEN lower(item_name) LIKE '%ceramic%' OR lower(item_name) LIKE '%coating%' THEN 500000
        WHEN lower(item_name) LIKE '%menzerna%' THEN 350000
        WHEN lower(item_name) LIKE '%shampoo%' THEN 150000
        WHEN lower(unit) LIKE '%liter%' THEN 200000
        WHEN lower(item_name) LIKE '%tape%' THEN 20000
        WHEN lower(item_name) LIKE '%pad%' THEN 75000
        WHEN lower(item_name) LIKE '%towel%' OR lower(item_name) LIKE '%microfiber%' THEN 35000
        ELSE 50000
      END;
  `);

  const items = await sql(
    `SELECT item_name, unit, purchase_unit, purchase_price, purchase_content_qty, unit_cost
     FROM public.inventory_items
     ORDER BY item_name ASC
     LIMIT 10`
  );
  console.log("Sample updated items:");
  console.table(items);
}

main().catch(console.error);
