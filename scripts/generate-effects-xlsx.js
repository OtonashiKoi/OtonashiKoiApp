#!/usr/bin/env node
const ExcelJS = require('exceljs');
const path = require('path');
const { EFFECT_DEFINITIONS } = require(path.join(__dirname, '..', 'src', 'shared', 'effectDefinitions'));
const { EFFECT_NAME_ZH } = require(path.join(__dirname, '..', 'src', 'shared', 'effectDisplayNames'));

async function generate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'equipmentGAME';

  // Lookup sheet
  const lookups = workbook.addWorksheet('lookups');
  lookups.properties.defaultRowHeight = 18;
  lookups.addRow(['label', 'key']);
  for (const def of EFFECT_DEFINITIONS) {
    const key = def.key;
    const label = EFFECT_NAME_ZH[key] || def.name || key;
    lookups.addRow([label, key]);
  }

  // Items sheet (template)
  const items = workbook.addWorksheet('items');
  const headers = [
    'id','name','type','rarity','description','effects_json',
    'effect1_label','effect1_key','effect1_trigger','effect1_target','effect1_chance','effect1_durationMode','effect1_durationValue','effect1_params_value','effect1_notes',
    'effect2_label','effect2_key','effect2_trigger','effect2_target','effect2_chance','effect2_durationMode','effect2_durationValue','effect2_params_value','effect2_notes'
  ];
  items.addRow(headers);

  const descriptions = [
    '說明: 道具唯一識別 (ex: item_001)',
    '說明: 道具名稱 (ex: 木劍)',
    '說明: 道具分類 (ex: weapon)',
    '說明: 稀有度 (ex: common)',
    '說明: 道具簡短敘述',
    '說明: 效果 JSON 陣列 (保留完整結構，建議用 JSON 編輯)',
    '說明: 效果1 中文顯示（下拉）',
    '說明: 效果1 key（會自動填入，匯出 CSV 時包含此欄）',
    '說明: 效果1 觸發',
    '說明: 效果1 目標',
    '說明: 效果1 機率',
    '說明: 效果1 持續模式',
    '說明: 效果1 持續數值',
    '說明: 效果1 參數數值',
    '說明: 效果1 備註',
    '說明: 效果2 中文顯示（下拉）',
    '說明: 效果2 key（會自動填入）',
    '說明: 效果2 觸發',
    '說明: 效果2 目標',
    '說明: 效果2 機率',
    '說明: 效果2 持續模式',
    '說明: 效果2 持續數值',
    '說明: 效果2 參數數值',
    '說明: 效果2 備註'
  ];
  items.addRow(descriptions);

  // Sample rows
  const sample1 = [
    'item_001','木劍','weapon','common','基礎武器',
    '[{"key":"atk_up","trigger":"passive","target":"self","chance":100,"stacks":1,"stackMode":"refresh","duration":{"mode":"permanent","value":0},"params":{"value":5},"notes":"裝備時攻擊+5"}]',
    EFFECT_NAME_ZH['atk_up'] || 'Attack Up',
    'atk_up','passive','self',100,'permanent',0,5,'裝備時攻擊+5',
    '','','','','','','','','',''
  ];
  const sample2 = [
    'item_002','毒匕首','weapon','rare','命中時有機率造成中毒',
    '[{"key":"poison","trigger":"on_hit","target":"enemy","chance":50,"stacks":1,"stackMode":"stack","duration":{"mode":"turns","value":3},"params":{"value":10},"notes":"命中時造成每回合傷害10"}]',
    EFFECT_NAME_ZH['poison'] || 'Poison',
    'poison','on_hit','enemy',50,'turns',3,10,'命中時造成每回合傷害10',
    '','','','','','','','','',''
  ];
  items.addRow(sample1);
  items.addRow(sample2);

  // create data validation list for lookup labels and VLOOKUP key auto-fill
  const lastLookupRow = lookups.rowCount;
  const labelRange = `lookups!$A$2:$A$${lastLookupRow}`;
  const lookupRangeForVlookup = `lookups!$A$2:$B$${lastLookupRow}`;

  // Set validations and formulas for a reasonable number of rows (3..500)
  for (let r = 3; r <= 500; r++) {
    const effect1LabelCell = items.getCell(`G${r}`);
    effect1LabelCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      showInputMessage: true,
      formulae: [`=${labelRange}`]
    };
    const effect1KeyCell = items.getCell(`H${r}`);
    effect1KeyCell.value = { formula: `=IF(G${r}="","",VLOOKUP(G${r},${lookupRangeForVlookup},2,FALSE))`, result: '' };

    const effect2LabelCell = items.getCell(`P${r}`);
    effect2LabelCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      showInputMessage: true,
      formulae: [`=${labelRange}`]
    };
    const effect2KeyCell = items.getCell(`Q${r}`);
    effect2KeyCell.value = { formula: `=IF(P${r}="","",VLOOKUP(P${r},${lookupRangeForVlookup},2,FALSE))`, result: '' };
  }

  // Adjust column widths for readability
  const colWidths = [15,18,12,12,28,40,28,18,12,12,10,14,12,12,18,28,18,12,12,10,14,12,12,18];
  items.columns.forEach((c, i) => { c.width = colWidths[i] || 14; });

  const outPath = path.join(__dirname, '..', 'exports', 'effects_template_with_dropdown.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Wrote Excel template to', outPath);
}

generate().catch((err) => {
  console.error('Failed to generate Excel template:', err);
  process.exit(1);
});
