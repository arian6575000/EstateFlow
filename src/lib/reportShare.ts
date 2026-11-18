import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import type { ReportTable } from '../db/reportRepo';
import { tableToCsv, tableToHtml } from './reportExport';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function share(uri: string, mime: string, title: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title });
}
export async function shareReportCsv(t: ReportTable, rangeLabel: string) {
  const f = new File(Paths.cache, `estateflow-${slug(t.title)}-${new Date().toISOString().slice(0, 10)}.csv`);
  if (f.exists) f.delete(); f.create(); f.write(tableToCsv(t, rangeLabel));
  await share(f.uri, 'text/csv', t.title);
}
export async function shareReportPdf(t: ReportTable, rangeLabel: string, business: string) {
  const { uri } = await Print.printToFileAsync({ html: tableToHtml(t, rangeLabel, business) });
  await share(uri, 'application/pdf', t.title);
}
