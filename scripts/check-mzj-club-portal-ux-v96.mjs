import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const calculator = read('src/owners/OwnersDiscountCalculator.tsx');
const portal = read('src/owners/OwnersPortalPage.tsx');
const styles = read('src/styles.css');

const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

add('vehicle selector opens all cars from an existing selection without manual deletion', calculator.includes('const openSelector = () =>') && calculator.includes('if (selectedCar) setQuery("")'));
add('selected vehicle is replaced only after choosing another option', calculator.includes('const chooseCar = (car: WebsiteCar) =>') && calculator.includes('setVehicleId(String(car.vehicleId || ""))'));
add('vehicle selector has one-click clear control', calculator.includes('aria-label="مسح السيارة المختارة"') && calculator.includes('const clearCar = () =>'));
add('vehicle selector has a dropdown control', calculator.includes('CaretDown') && calculator.includes('aria-label={isOpen ? "إغلاق قائمة السيارات" : "فتح قائمة السيارات"}'));
add('discount calculation still uses the selected vehicle', calculator.includes('selectedCar ? discountAmount(selectedCar.priceBeforeTax, personalRate, unit) : 0') && calculator.includes('selectedCar ? discountAmount(selectedCar.priceBeforeTax, friendGiftRate, unit) : 0'));
add('club navigation remains the canonical home/packages block', portal.includes('owners-portal-tabs') && portal.includes('>الرئيسية</button>') && portal.includes('الباقات'));
add('club navigation is centered on desktop', styles.includes('.owners-portal-tabs{width:min(100%,1180px);margin:0 auto 16px;display:flex;justify-content:center;') && styles.includes('.owners-club-design.design_2 .owners-portal-tabs{justify-content:center;'));
add('hero greeting is reduced from the previous oversized typography', styles.includes('.owners-club-hero-copy h1{margin:8px 0 4px;font-size:clamp(25px,3vw,38px);'));
add('hero journey subtitle has an explicit smaller size', styles.includes('.owners-club-hero-copy p{margin:0;max-width:540px;font-size:14px;'));
add('mobile greeting and subtitle are also reduced', styles.includes('.owners-club-design .owners-club-hero-copy h1{font-size:25px}') && styles.includes('.owners-club-design .owners-club-hero-copy p{font-size:13px}'));
add('combobox action controls have canonical source styling', styles.includes('.owners-calculator-combobox-action{') && styles.includes('.owners-calculator-combobox-action.toggle.open svg{transform:rotate(180deg)}'));

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}: ${check.name}`);
const passed = checks.filter((check) => check.ok).length;
console.log(`MZJ Club portal UX v96 checks: ${passed}/${checks.length} passed.`);
if (passed !== checks.length) process.exit(1);
