function median(values) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function calculateSampleWindowSeconds(samples) {
  if (samples.length < 2) return 0;
  return Number(((samples.at(-1).sampledAtMs - samples[0].sampledAtMs) / 1_000).toFixed(3));
}

export function summarizeProcessSamples(samples) {
  const byProcess = new Map();

  for (const sample of samples) {
    for (const process of sample) {
      const key = process.name || process.type;
      const aggregate = byProcess.get(key) ?? { cpu: [], workingSetMB: [] };
      aggregate.cpu.push(process.cpu);
      aggregate.workingSetMB.push(process.workingSetMB);
      byProcess.set(key, aggregate);
    }
  }

  return Object.fromEntries(
    [...byProcess.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [
        key,
        {
          cpuAverage: Number(
            (values.cpu.reduce((sum, current) => sum + current, 0) / values.cpu.length).toFixed(3),
          ),
          workingSetMedianMB: Number(median(values.workingSetMB)?.toFixed(1)),
        },
      ]),
  );
}

function resourceBasename(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
  } catch {
    return url.split(/[\\/]/).at(-1) ?? url;
  }
}

export function collectRuntimeResources(frameTree) {
  const resources = new Set();

  const visit = (tree) => {
    for (const resource of tree.resources ?? []) {
      if (/\.(?:css|js)(?:\?|$)/i.test(resource.url)) {
        resources.add(resourceBasename(resource.url));
      }
    }
    for (const child of tree.childFrames ?? []) visit(child);
  };

  visit(frameTree);
  return [...resources].sort();
}

export function selectGpuDiagnostics({ accelerated, features, basic }) {
  const adapterFields = ['active', 'vendorId', 'deviceId', 'driverVendor', 'driverVersion'];
  const adapters = (basic?.gpuDevice ?? []).map((adapter) =>
    Object.fromEntries(
      adapterFields
        .filter((field) => adapter[field] !== undefined)
        .map((field) => [field, adapter[field]]),
    ),
  );

  return {
    accelerated,
    features,
    adapters,
    renderer: basic?.auxAttributes?.glRenderer ?? null,
  };
}
