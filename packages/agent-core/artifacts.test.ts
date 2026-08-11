import { describe, expect, it } from "vitest";
import {
  buildDurableFilePath,
  inferArtifactType,
  mapSandboxFilesToArtifacts,
} from "./artifacts";

describe("inferArtifactType", () => {
  it("detects common extensions", () => {
    expect(inferArtifactType("report.pdf")).toBe("pdf");
    expect(inferArtifactType("sheet.csv")).toBe("csv");
    expect(inferArtifactType("plot.png")).toBe("image");
    expect(inferArtifactType("main.py")).toBe("code");
    expect(inferArtifactType("doc.docx")).toBe("docx");
  });
});

describe("mapSandboxFilesToArtifacts", () => {
  it("maps sandbox files to artifact rows with durable paths", () => {
    const files = [
      {
        name: "out.csv",
        path: "out.csv",
        size: 12,
        media_type: "text/csv",
        content_base64: Buffer.from("a,b\n1,2\n").toString("base64"),
      },
      {
        name: "chart.png",
        path: "charts/chart.png",
        size: 4,
        media_type: "image/png",
        content_base64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      },
    ];

    const threadId = "11111111-1111-1111-1111-111111111111";
    const rows = mapSandboxFilesToArtifacts(threadId, files, {
      source: "execute_code",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].thread_id).toBe(threadId);
    expect(rows[0].type).toBe("csv");
    expect(rows[0].file_path.startsWith("data:text/csv;base64,")).toBe(true);
    expect(rows[0].metadata.name).toBe("out.csv");
    expect(rows[0].metadata.source).toBe("execute_code");

    expect(rows[1].type).toBe("image");
    expect(rows[1].metadata.path).toBe("charts/chart.png");
  });

  it("uses path prefix when base64 is huge", () => {
    const big = "a".repeat(2_000_000);
    const path = buildDurableFilePath({
      name: "big.bin",
      path: "big.bin",
      size: big.length,
      media_type: "application/octet-stream",
      content_base64: big,
    });
    expect(path).toBe("/mnt/data/big.bin");
  });
});
