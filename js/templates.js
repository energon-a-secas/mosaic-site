// Presets change the arrangement, never the photo pool or its edits.
export const TEMPLATES = [
  { id: 'pair', name: 'Side by side', ratio: '16:9', cols: 2, count: 2 },
  { id: 'square', name: 'Square grid', ratio: '1:1', cols: 2, count: 4 },
  { id: 'stack', name: 'Stacked', ratio: '4:5', cols: 1, count: 2 },
  { id: 'portrait', name: 'Portrait', ratio: '4:5', cols: 2, count: 4 },
  { id: 'story', name: 'Story', ratio: '9:16', cols: 1, count: 2 },
  { id: 'banner', name: 'Wide banner', ratio: '19:6', cols: 2, count: 2 },
];

export function applyTemplate(state, id) {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) return;
  state.layout = 'grid';
  state.params.cols = template.cols;
  state.params.ratio = template.ratio;
}

export const matchesTemplate = (state, template) => state.layout === 'grid'
  && state.params.cols === template.cols && state.params.ratio === template.ratio;
