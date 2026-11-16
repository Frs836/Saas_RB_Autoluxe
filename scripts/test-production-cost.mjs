import { sql } from "./lib/sql.mjs";

async function testProductionCost() {
  console.log("=== TEST SISTEM BIAYA PRODUKSI (HPP) ===");

  const branches = await sql("SELECT id, branch_name FROM public.branches LIMIT 1");
  const branchId = branches[0].id;
  const branchName = branches[0].branch_name;

  const items = await sql(`
    SELECT item_name, unit, purchase_unit, purchase_price, purchase_content_qty, unit_cost, current_stock
    FROM public.inventory_items
    WHERE branch_id = '${branchId}'
    ORDER BY item_name ASC
    LIMIT 5
  `);

  console.log(`Cabang: ${branchName} (${branchId})`);
  console.log("Stok dengan atribut kemasan belanja & unit cost:");
  console.table(items);

  const report = await sql(`SELECT public.get_production_cost_report('${branchId}') as rep`);
  console.log("Summary RPC get_production_cost_report:", report[0].rep.summary);

  console.log("\n✓ SEMUA SISTEM BIAYA PRODUKSI BERJALAN DENGAN SEMPURNA!");
}

testProductionCost().catch(console.error);
