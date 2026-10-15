const m = require('./components/ui/icon-paths');
const ICON_PATHS = m.ICON_PATHS;
const used = ['verified','wrong_location','storefront','apps','hourglass_top','task_alt','swap_horiz','construction','desk','public','check'];
used.forEach(n => console.log(n + ':', ICON_PATHS[n] ? 'EXISTS' : 'MISSING'));