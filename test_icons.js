const m = require('./components/ui/icon-paths');
const ICON_PATHS = m.ICON_PATHS;
const testNames = ['verified', 'wrong_location', 'storefront', 'apps', 'hourglass_top', 'task_alt', 'swap_horiz', 'construction', 'desk'];
testNames.forEach(name => {
  console.log(name + ':', ICON_PATHS[name] ? 'EXISTS' : 'MISSING');
});