/**
 * Units a store item can be counted in: SI and metric, imperial and US
 * customary, the trade and packaging units a yard buys in, and the Sri
 * Lankan land and bulk units (perch, rood, cube). A unit that is not here can
 * still be typed in — the picker offers the search text itself.
 *
 * The symbol is what is stored on the item and shown after a quantity
 * (`12 kg`, `3 බෑග්`), so a symbol, once used, should not change.
 */

export type UnitGroup =
  | 'count'
  | 'volume'
  | 'mass'
  | 'length'
  | 'area'
  | 'time'
  | 'energy'
  | 'pressure'
  | 'temperature'
  | 'rate';

export interface Unit {
  symbol: string;
  english: string;
  sinhala: string;
  group: UnitGroup;
  /** Other spellings people search by. */
  aliases: readonly string[];
}

export const UNIT_GROUPS: readonly { id: UnitGroup; label: string }[] = [
  { id: 'count', label: 'ගණන සහ ඇසුරුම් · Count & packaging' },
  { id: 'volume', label: 'පරිමාව · Volume' },
  { id: 'mass', label: 'බර · Mass' },
  { id: 'length', label: 'දිග · Length' },
  { id: 'area', label: 'වර්ගඵලය · Area' },
  { id: 'time', label: 'කාලය · Time' },
  { id: 'energy', label: 'ශක්තිය සහ විදුලිය · Energy & electrical' },
  { id: 'pressure', label: 'පීඩනය · Pressure' },
  { id: 'temperature', label: 'උෂ්ණත්වය · Temperature' },
  { id: 'rate', label: 'වේගය සහ ප්‍රවාහය · Speed & flow' },
];

function unit(group: UnitGroup, symbol: string, english: string, sinhala: string, aliases: string[] = []): Unit {
  return { group, symbol, english, sinhala, aliases };
}

/** In group order, so the unfiltered list reads group by group. */
export const UNITS: readonly Unit[] = [
  // ---- count and packaging ----
  unit('count', 'ගණන', 'Pieces (count)', 'ගණන / කෑලි', ['pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'unit', 'units', 'each', 'ea', 'count', 'කෑලි']),
  unit('count', 'යුගල', 'Pair', 'යුගල', ['pair', 'pairs', 'pr']),
  unit('count', 'ඩසින්', 'Dozen (12)', 'ඩසින්', ['dozen', 'doz', 'dz']),
  unit('count', 'ග්‍රෝස්', 'Gross (144)', 'ග්‍රෝස්', ['gross']),
  unit('count', 'කට්ටල', 'Set / kit', 'කට්ටල', ['set', 'sets', 'kit']),
  unit('count', 'පෙට්ටි', 'Box', 'පෙට්ටි', ['box', 'boxes', 'bx']),
  unit('count', 'පැකට්', 'Packet / pack', 'පැකට්', ['packet', 'pack', 'pkt', 'pk']),
  unit('count', 'කාටන්', 'Carton / case', 'කාටන්', ['carton', 'ctn', 'case']),
  unit('count', 'බෑග්', 'Bag', 'බෑග්', ['bag', 'bags', 'cement']),
  unit('count', 'ගෝනි', 'Sack', 'ගෝනි', ['sack', 'sacks', 'gunny']),
  unit('count', 'මිටි', 'Bundle', 'මිටි', ['bundle', 'bdl']),
  unit('count', 'රෝල්', 'Roll', 'රෝල්', ['roll', 'rolls']),
  unit('count', 'දඟර', 'Coil', 'දඟර', ['coil', 'coils']),
  unit('count', 'රීල්', 'Reel / spool', 'රීල්', ['reel', 'spool']),
  unit('count', 'බෝතල්', 'Bottle', 'බෝතල්', ['bottle', 'btl']),
  unit('count', 'කෑන්', 'Can', 'කෑන්', ['can', 'cans']),
  unit('count', 'ටින්', 'Tin', 'ටින්', ['tin', 'tins']),
  unit('count', 'බාල්දි', 'Bucket / pail', 'බාල්දි', ['bucket', 'pail']),
  unit('count', 'ජෙරිකෑන්', 'Jerrycan', 'ජෙරිකෑන්', ['jerrycan', 'jerry can']),
  unit('count', 'ඩ්‍රම්', 'Drum', 'ඩ්‍රම්', ['drum', 'drums']),
  unit('count', 'බැරල්', 'Barrel (container)', 'බැරල්', ['barrel', 'barrels']),
  unit('count', 'සිලින්ඩර', 'Cylinder', 'සිලින්ඩර', ['cylinder', 'gas']),
  unit('count', 'ටියුබ්', 'Tube', 'ටියුබ්', ['tube', 'tubes']),
  unit('count', 'කාට්‍රිජ්', 'Cartridge', 'කාට්‍රිජ්', ['cartridge']),
  unit('count', 'ෂීට්', 'Sheet / plate', 'ෂීට්', ['sheet', 'sheets', 'plate']),
  unit('count', 'ලෑලි', 'Board / plank', 'ලෑලි', ['board', 'plank', 'timber']),
  unit('count', 'කූරු', 'Bar / rod', 'කූරු / බාර්', ['bar', 'rod', 'rods', 'steel']),
  unit('count', 'දිග', 'Length (of pipe or rod)', 'දිග', ['length', 'lengths', 'pipe']),
  unit('count', 'පැලට්', 'Pallet', 'පැලට්', ['pallet']),
  unit('count', 'ලෝඩ්', 'Load (lorry / tipper)', 'ලෝඩ්', ['load', 'loads', 'lorry', 'tipper', 'truck']),
  unit('count', 'වාර', 'Trip', 'වාර', ['trip', 'trips']),

  // ---- volume ----
  unit('volume', 'mL', 'Millilitre', 'මිලිලීටර්', ['ml', 'milliliter', 'millilitre']),
  unit('volume', 'cL', 'Centilitre', 'සෙන්ටිලීටර්', ['cl']),
  unit('volume', 'dL', 'Decilitre', 'ඩෙසිලීටර්', ['dl']),
  unit('volume', 'L', 'Litre', 'ලීටර්', ['l', 'litre', 'liter', 'litres', 'liters', 'ltr', 'lit']),
  unit('volume', 'hL', 'Hectolitre', 'හෙක්ටොලීටර්', ['hl']),
  unit('volume', 'm³', 'Cubic metre', 'ඝන මීටර්', ['m3', 'cubic metre', 'cubic meter', 'cbm', 'cu m']),
  unit('volume', 'cm³', 'Cubic centimetre (cc)', 'ඝන සෙන්ටිමීටර්', ['cm3', 'cc', 'cubic centimetre']),
  unit('volume', 'ft³', 'Cubic foot', 'ඝන අඩි', ['ft3', 'cubic feet', 'cubic foot', 'cu ft', 'cft']),
  unit('volume', 'in³', 'Cubic inch', 'ඝන අඟල්', ['in3', 'cubic inch', 'cu in']),
  unit('volume', 'yd³', 'Cubic yard', 'ඝන යාර', ['yd3', 'cubic yard', 'cu yd']),
  unit('volume', 'කියුබ්', 'Cube (100 ft³ — sand, metal)', 'කියුබ්', ['cube', 'cubes', 'sand', 'metal', 'gravel']),
  unit('volume', 'gal (US)', 'US gallon', 'ගැලුම් (ඇමරිකානු)', ['gallon', 'gallons', 'gal', 'us gallon']),
  unit('volume', 'gal (UK)', 'Imperial gallon', 'ගැලුම් (බ්‍රිතාන්‍ය)', ['gallon', 'gallons', 'gal', 'imperial gallon', 'uk gallon']),
  unit('volume', 'qt', 'Quart', 'ක්වාට්', ['quart', 'quarts']),
  unit('volume', 'pt (US)', 'US pint', 'පයින්ට් (ඇමරිකානු)', ['pint', 'pints']),
  unit('volume', 'pt (UK)', 'Imperial pint', 'පයින්ට් (බ්‍රිතාන්‍ය)', ['pint', 'pints']),
  unit('volume', 'fl oz', 'Fluid ounce', 'දියර අවුන්ස', ['fluid ounce', 'floz']),
  unit('volume', 'cup', 'Cup', 'කෝප්ප', ['cup', 'cups']),
  unit('volume', 'tbsp', 'Tablespoon', 'මේස හැඳි', ['tablespoon']),
  unit('volume', 'tsp', 'Teaspoon', 'තේ හැඳි', ['teaspoon']),
  unit('volume', 'bbl', 'Barrel (oil, 159 L)', 'තෙල් බැරල්', ['barrel', 'oil barrel']),

  // ---- mass ----
  unit('mass', 'µg', 'Microgram', 'මයික්‍රොග්‍රෑම්', ['ug', 'mcg', 'microgram']),
  unit('mass', 'mg', 'Milligram', 'මිලිග්‍රෑම්', ['milligram']),
  unit('mass', 'g', 'Gram', 'ග්‍රෑම්', ['gram', 'grams', 'gm', 'gms']),
  unit('mass', 'kg', 'Kilogram', 'කිලෝග්‍රෑම්', ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs']),
  unit('mass', 't', 'Tonne (metric ton)', 'මෙට්‍රික් ටොන්', ['tonne', 'tonnes', 'metric ton', 'ton', 'tons', 'mt']),
  unit('mass', 'q', 'Quintal (100 kg)', 'ක්වින්ටල්', ['quintal']),
  unit('mass', 'ct', 'Carat', 'කැරට්', ['carat']),
  unit('mass', 'gr', 'Grain', 'ග්‍රේන්', ['grain']),
  unit('mass', 'oz', 'Ounce', 'අවුන්ස', ['ounce', 'ounces']),
  unit('mass', 'lb', 'Pound', 'පවුම්', ['pound', 'pounds', 'lbs']),
  unit('mass', 'st', 'Stone', 'ස්ටෝන්', ['stone']),
  unit('mass', 'sh tn', 'Short ton (US)', 'ඇමරිකානු ටොන්', ['short ton', 'us ton', 'ton']),
  unit('mass', 'LT', 'Long ton (UK)', 'බ්‍රිතාන්‍ය ටොන්', ['long ton', 'uk ton', 'ton']),

  // ---- length ----
  unit('length', 'µm', 'Micrometre (micron)', 'මයික්‍රොමීටර්', ['um', 'micron', 'micrometre']),
  unit('length', 'mm', 'Millimetre', 'මිලිමීටර්', ['millimetre', 'millimeter']),
  unit('length', 'cm', 'Centimetre', 'සෙන්ටිමීටර්', ['centimetre', 'centimeter']),
  unit('length', 'm', 'Metre', 'මීටර්', ['metre', 'meter', 'metres', 'meters', 'mtr']),
  unit('length', 'km', 'Kilometre', 'කිලෝමීටර්', ['kilometre', 'kilometer']),
  unit('length', 'in', 'Inch', 'අඟල්', ['inch', 'inches']),
  unit('length', 'ft', 'Foot', 'අඩි', ['foot', 'feet']),
  unit('length', 'yd', 'Yard', 'යාර', ['yard', 'yards']),
  unit('length', 'mi', 'Mile', 'සැතපුම්', ['mile', 'miles']),
  unit('length', 'nmi', 'Nautical mile', 'නාවික සැතපුම්', ['nautical mile']),
  unit('length', 'ch', 'Chain (66 ft)', 'චේන්', ['chain', 'chains']),

  // ---- area ----
  unit('area', 'mm²', 'Square millimetre', 'වර්ග මිලිමීටර්', ['mm2', 'sq mm']),
  unit('area', 'cm²', 'Square centimetre', 'වර්ග සෙන්ටිමීටර්', ['cm2', 'sq cm']),
  unit('area', 'm²', 'Square metre', 'වර්ග මීටර්', ['m2', 'sq m', 'sqm', 'square metre', 'square meter']),
  unit('area', 'km²', 'Square kilometre', 'වර්ග කිලෝමීටර්', ['km2', 'sq km']),
  unit('area', 'ha', 'Hectare', 'හෙක්ටයාර', ['hectare', 'hectares']),
  unit('area', 'ac', 'Acre', 'අක්කර', ['acre', 'acres']),
  unit('area', 'rood', 'Rood (40 perches)', 'රූඩ්', ['rood', 'roods']),
  unit('area', 'perch', 'Perch', 'පර්චස්', ['perch', 'perches', 'p']),
  unit('area', 'ft²', 'Square foot', 'වර්ග අඩි', ['ft2', 'sq ft', 'sqft', 'square feet']),
  unit('area', 'in²', 'Square inch', 'වර්ග අඟල්', ['in2', 'sq in']),
  unit('area', 'yd²', 'Square yard', 'වර්ග යාර', ['yd2', 'sq yd']),
  unit('area', 'mi²', 'Square mile', 'වර්ග සැතපුම්', ['mi2', 'sq mi']),
  unit('area', 'sq', 'Square (100 ft², roofing)', 'ස්ක්වෙයාර්', ['square', 'roofing']),

  // ---- time ----
  unit('time', 's', 'Second', 'තත්පර', ['second', 'seconds', 'sec']),
  unit('time', 'min', 'Minute', 'මිනිත්තු', ['minute', 'minutes']),
  unit('time', 'h', 'Hour', 'පැය', ['hour', 'hours', 'hr', 'hrs']),
  unit('time', 'දින', 'Day', 'දින', ['day', 'days']),
  unit('time', 'සති', 'Week', 'සති', ['week', 'weeks']),
  unit('time', 'මාස', 'Month', 'මාස', ['month', 'months']),
  unit('time', 'අවුරුදු', 'Year', 'අවුරුදු', ['year', 'years', 'yr']),

  // ---- energy and electrical ----
  unit('energy', 'W', 'Watt', 'වොට්', ['watt', 'watts']),
  unit('energy', 'kW', 'Kilowatt', 'කිලෝවොට්', ['kilowatt']),
  unit('energy', 'hp', 'Horsepower', 'අශ්වබල', ['horsepower']),
  unit('energy', 'Wh', 'Watt-hour', 'වොට් පැය', ['watt hour']),
  unit('energy', 'kWh', 'Kilowatt-hour (electricity unit)', 'කිලෝවොට් පැය (ඒකක)', ['kilowatt hour', 'electricity', 'unit']),
  unit('energy', 'J', 'Joule', 'ජූල්', ['joule']),
  unit('energy', 'kJ', 'Kilojoule', 'කිලෝජූල්', ['kilojoule']),
  unit('energy', 'MJ', 'Megajoule', 'මෙගාජූල්', ['megajoule']),
  unit('energy', 'cal', 'Calorie', 'කැලරි', ['calorie']),
  unit('energy', 'kcal', 'Kilocalorie', 'කිලෝකැලරි', ['kilocalorie']),
  unit('energy', 'BTU', 'British thermal unit', 'බ්‍රිතාන්‍ය තාප ඒකක', ['btu']),
  unit('energy', 'A', 'Ampere', 'ඇම්පියර්', ['amp', 'amps', 'ampere']),
  unit('energy', 'Ah', 'Ampere-hour (battery)', 'ඇම්පියර් පැය', ['amp hour', 'battery']),
  unit('energy', 'V', 'Volt', 'වෝල්ට්', ['volt', 'volts']),
  unit('energy', 'kVA', 'Kilovolt-ampere', 'කිලෝවෝල්ට් ඇම්පියර්', ['kva', 'generator']),

  // ---- pressure ----
  unit('pressure', 'Pa', 'Pascal', 'පැස්කල්', ['pascal']),
  unit('pressure', 'kPa', 'Kilopascal', 'කිලෝපැස්කල්', ['kilopascal']),
  unit('pressure', 'MPa', 'Megapascal', 'මෙගාපැස්කල්', ['megapascal']),
  unit('pressure', 'bar', 'Bar', 'බාර්', ['bars']),
  unit('pressure', 'psi', 'Pounds per square inch', 'psi', ['pound per square inch']),
  unit('pressure', 'atm', 'Atmosphere', 'වායුගෝල', ['atmosphere']),

  // ---- temperature ----
  unit('temperature', '°C', 'Degree Celsius', 'සෙල්සියස්', ['c', 'celsius', 'centigrade']),
  unit('temperature', '°F', 'Degree Fahrenheit', 'ෆැරන්හයිට්', ['f', 'fahrenheit']),
  unit('temperature', 'K', 'Kelvin', 'කෙල්වින්', ['kelvin']),

  // ---- speed and flow ----
  unit('rate', 'km/h', 'Kilometres per hour', 'පැයට කිලෝමීටර්', ['kmh', 'kph']),
  unit('rate', 'm/s', 'Metres per second', 'තත්පරයට මීටර්', ['mps']),
  unit('rate', 'mph', 'Miles per hour', 'පැයට සැතපුම්', ['miles per hour']),
  unit('rate', 'L/min', 'Litres per minute', 'මිනිත්තුවට ලීටර්', ['lpm']),
  unit('rate', 'L/h', 'Litres per hour', 'පැයට ලීටර්', ['lph', 'fuel consumption']),
  unit('rate', 'm³/h', 'Cubic metres per hour', 'පැයට ඝන මීටර්', ['m3/h']),
  unit('rate', 'gpm', 'Gallons per minute', 'මිනිත්තුවට ගැලුම්', ['gallons per minute']),
];

export function findUnit(symbol: string): Unit | undefined {
  return UNITS.find((candidate) => candidate.symbol === symbol);
}

export function groupLabel(group: UnitGroup): string {
  return UNIT_GROUPS.find((entry) => entry.id === group)?.label ?? '';
}

/**
 * Every unit matching [query], best first: an exact symbol, then an exact
 * alias, then anything that starts with the query, then anything containing
 * it. An empty query returns the whole list in group order.
 */
export function searchUnits(query: string): Unit[] {
  const raw = query.trim();
  const needle = raw.toLowerCase();
  if (!needle) return [...UNITS];

  const rank = (candidate: Unit): number => {
    const symbol = candidate.symbol.toLowerCase();
    const english = candidate.english.toLowerCase();
    if (symbol === needle) return 0;
    if (candidate.aliases.includes(needle)) return 1;
    if (symbol.startsWith(needle) || english.startsWith(needle) || candidate.sinhala.startsWith(raw)) return 2;
    const haystack = [symbol, english, candidate.sinhala, ...candidate.aliases].join(' ').toLowerCase();
    return haystack.includes(needle) ? 3 : -1;
  };

  return UNITS.map((candidate) => ({ candidate, score: rank(candidate) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.candidate);
}
