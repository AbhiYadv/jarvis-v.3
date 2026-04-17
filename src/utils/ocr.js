/**
 * macOS Vision OCR — extracts text from a screenshot image.
 * Compiles a Swift binary on first use (~5s), then runs in <150ms every time.
 * Falls back to null on any failure so the caller can use image mode instead.
 */

const { execFile, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Store compiled binary next to this file so it survives restarts
const BINARY_PATH = path.join(__dirname, 'ocr_tool');

const SWIFT_SOURCE = `
import Vision
import AppKit
import Foundation

guard CommandLine.arguments.count > 1 else { exit(1) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let tiffData = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    print("")
    exit(0)
}

var resultText = ""
let semaphore = DispatchSemaphore(value: 0)
let request = VNRecognizeTextRequest { req, _ in
    let obs = req.results as? [VNRecognizedTextObservation] ?? []
    resultText = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
    semaphore.signal()
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
_ = semaphore.wait(timeout: .now() + 5)
print(resultText)
`;

let binaryReady = false;
let compiling = false;
let compileQueue = [];

function ensureBinary() {
    return new Promise((resolve) => {
        if (binaryReady) { resolve(true); return; }
        if (fs.existsSync(BINARY_PATH)) { binaryReady = true; resolve(true); return; }

        if (compiling) {
            compileQueue.push(resolve);
            return;
        }

        compiling = true;
        console.log('[OCR] Compiling Vision OCR binary (one-time ~5s)...');

        const tmpSwift = path.join(os.tmpdir(), 'jarvis_ocr.swift');
        fs.writeFileSync(tmpSwift, SWIFT_SOURCE);

        exec(`swiftc "${tmpSwift}" -o "${BINARY_PATH}"`, { timeout: 30000 }, (err) => {
            try { fs.unlinkSync(tmpSwift); } catch (_) {}
            compiling = false;
            if (err) {
                console.error('[OCR] Compile failed:', err.message);
                binaryReady = false;
                resolve(false);
                compileQueue.forEach(r => r(false));
            } else {
                console.log('[OCR] Binary compiled successfully');
                binaryReady = true;
                resolve(true);
                compileQueue.forEach(r => r(true));
            }
            compileQueue = [];
        });
    });
}

async function extractTextFromScreenshot(base64Data) {
    const ready = await ensureBinary();
    if (!ready) return null;

    const tmpImg = path.join(os.tmpdir(), `jarvis_ocr_${Date.now()}.jpg`);
    try {
        fs.writeFileSync(tmpImg, Buffer.from(base64Data, 'base64'));
    } catch (e) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(BINARY_PATH, [tmpImg], { timeout: 4000 }, (err, stdout) => {
            try { fs.unlinkSync(tmpImg); } catch (_) {}
            if (err || !stdout) { resolve(null); return; }
            const text = stdout.trim();
            // Reject if OCR returned less than 20 chars — likely a blank/non-text screen
            resolve(text.length >= 20 ? text : null);
        });
    });
}

// Kick off compilation in background at require() time so it's ready when first needed
ensureBinary().catch(() => {});

module.exports = { extractTextFromScreenshot };
