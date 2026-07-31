import PDFDocument from "pdfkit";

export type PensacolaReportData = {
  generatedAt: Date;
  title: string;
  subtitle: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
};

export function buildPensacolaReportData(): PensacolaReportData {
  return {
    generatedAt: new Date(),
    title: "Pensacola Food Truck Parking Report",
    subtitle:
      "A high-level guide to profitable parking types and neighborhoods (no exact addresses).",
    sections: [
      {
        heading: "Top parking types (highest conversion)",
        bullets: [
          "Brewery taprooms (late afternoon + evening)",
          "Office parks (weekday lunch)",
          "Apartment communities (weekday dinner)",
          "Farmers markets + community events (weekend mornings)",
          "Gyms + boutique fitness (evening foot traffic)",
        ],
      },
      {
        heading: "Neighborhood targets (Pensacola)",
        bullets: [
          "Downtown / Palafox corridor",
          "Cordova / Scenic Heights",
          "East Hill",
          "Navy Blvd corridor (select venues)",
          "Pensacola Beach (event-driven)",
        ],
      },
      {
        heading: "What to do next (2 minutes)",
        bullets: [
          "Create a free MealScout account to unlock live availability.",
          "Browse Pensacola spots and book a guaranteed slot.",
          "Use the complete profile tools for live GPS, schedules, and the booking calendar. The free trial has no expiration or monthly bill.",
        ],
      },
    ],
  };
}

export async function renderPensacolaReportPdfBuffer(
  data: PensacolaReportData,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));
  });

  doc.fontSize(20).text(data.title, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#374151").text(data.subtitle);
  doc.moveDown(0.5);
  doc
    .fontSize(9)
    .fillColor("#6b7280")
    .text(`Generated: ${data.generatedAt.toLocaleString()}`);

  doc.moveDown(1);
  doc.fillColor("#111827");

  for (const section of data.sections) {
    doc.fontSize(13).text(section.heading);
    doc.moveDown(0.3);
    doc.fontSize(11);
    for (const bullet of section.bullets) {
      doc.text(`• ${bullet}`, { indent: 16 });
    }
    doc.moveDown(0.8);
  }

  doc.fontSize(9).fillColor("#6b7280");
  doc.text(
    "Note: This report intentionally excludes exact addresses and contact info. Use MealScout to see live availability and book.",
  );

  doc.end();
  return done;
}
