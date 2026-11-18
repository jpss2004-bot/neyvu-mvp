// Offline OCR using macOS frameworks. Originals arrive on stdin; no URLs or network API.
import Foundation
import Vision
import PDFKit
import AppKit
import ImageIO

// x/y/w/h: Vision's normalized bounding box (origin bottom-left). alt: confidence of the
// runner-up transcription, when Vision offers one. Optional fields keep older parsers valid.
struct Line: Codable { let text: String; let confidence: Float; let x: Double; let y: Double; var w: Double? = nil; var h: Double? = nil; var alt: Float? = nil; var corrected: String? = nil }
struct Page: Codable { let page: Int; let lines: [Line]; var width: Int? = nil; var height: Int? = nil; var orientation: String? = nil; var correction_checked: Bool? = nil }
struct Output: Codable { let pages: [Page]; let total: Int; let truncated: Bool }
func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation = .up, correction: Bool = false) throws -> [Line] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US", "es-ES", "de-DE", "fr-FR"]
    if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
    request.usesLanguageCorrection = correction // Primary pass retains observed wording; never repair numbers/formulas.
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    return (request.results ?? []).prefix(1500).compactMap { observation in
        let candidates = observation.topCandidates(2)
        guard let best = candidates.first, !best.string.isEmpty else { return nil }
        let box = observation.boundingBox
        let alt = candidates.count > 1 && candidates[1].string != best.string ? candidates[1].confidence : nil
        return Line(text: best.string, confidence: best.confidence, x: box.origin.x, y: box.origin.y, w: box.width, h: box.height, alt: alt)
    }
}
do {
    guard CommandLine.arguments.count == 3, ["pdf", "image"].contains(CommandLine.arguments[1]) else { throw NSError(domain: "Invalid mode", code: 1) }
    let raw = FileHandle.standardInput.readDataToEndOfFile()
    guard !raw.isEmpty && raw.count <= 10*1024*1024 else { throw NSError(domain: "Input limit", code: 1) }
    let wanted = CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }
    guard !wanted.isEmpty && wanted.count <= 500 && Set(wanted).count == wanted.count && wanted.allSatisfy({ $0 > 0 && $0 <= 500 }) else { throw NSError(domain: "Page limit", code: 1) }
    let started = Date()
    var pages: [Page] = []; var total = 1; var characters = 0; var truncated = false
    if CommandLine.arguments[1] == "pdf" {
        guard let document = PDFDocument(data: raw), !document.isLocked || document.unlock(withPassword: "") else { throw NSError(domain: "Unreadable PDF", code: 1) }
        total = document.pageCount
        for number in wanted {
            if Date().timeIntervalSince(started) > 60 { truncated = true; break }
            guard number <= total, let page = document.page(at: number-1) else { throw NSError(domain: "Missing page", code: 1) }
            let lines: [Line] = try autoreleasepool {
                let bounds = page.bounds(for: .mediaBox)
                guard bounds.width > 0 && bounds.height > 0 else { throw NSError(domain: "Invalid page bounds", code: 1) }
                let scale = min(2.5, 2200/max(bounds.width,bounds.height))
                let image = page.thumbnail(of: NSSize(width: bounds.width*scale,height: bounds.height*scale), for: .mediaBox)
                guard let cg = image.cgImage(forProposedRect: nil,context: nil,hints: nil) else { throw NSError(domain: "Rendering failed", code: 1) }
                return try recognize(cg)
            }
            let bytes = lines.reduce(0) { $0 + $1.text.utf8.count }
            if characters + bytes > 512000 { truncated = true; break }
            pages.append(Page(page:number,lines:lines));characters += bytes
        }
    } else {
        guard wanted == [1], let source = CGImageSourceCreateWithData(raw as CFData,nil) else { throw NSError(domain: "Unreadable image", code: 1) }
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:2200,kCGImageSourceCreateThumbnailWithTransform:true]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source,0,options as CFDictionary) else { throw NSError(domain: "Image decode failed", code: 1) }
        // EXIF orientation is already applied by the thumbnail transform. Vision reads
        // sideways text itself; a photo taken upside down is retried once, and the
        // reading with more recognized characters is kept (the choice is reported).
        var lines = try recognize(image); var orientation = "up"
        let count = { (items: [Line]) in items.reduce(0) { $0 + $1.text.count } }
        if count(lines) < 40 && Date().timeIntervalSince(started) < 30 {
            let flipped = try recognize(image, orientation: .down)
            if count(flipped) > count(lines) * 2 { lines = flipped; orientation = "down" }
        }
        // Vision reports 1.0 for most accurate-level lines, including misreads. A second,
        // language-corrected pass is used only as a disagreement signal: the observed
        // wording stays primary and the corrected reading is reported beside it.
        var correctionChecked = false
        if !lines.isEmpty && Date().timeIntervalSince(started) < 45 {
            correctionChecked = true
            let checked = try recognize(image, orientation: orientation == "down" ? .down : .up, correction: true)
            func overlap(_ a: Line, _ b: Line) -> Double {
                guard let aw = a.w, let ah = a.h, let bw = b.w, let bh = b.h else { return 0 }
                let ix = max(0, min(a.x+aw, b.x+bw) - max(a.x, b.x)), iy = max(0, min(a.y+ah, b.y+bh) - max(a.y, b.y))
                let union = aw*ah + bw*bh - ix*iy
                return union > 0 ? ix*iy/union : 0
            }
            lines = lines.map { line in
                var line = line
                if let match = checked.max(by: { overlap(line, $0) < overlap(line, $1) }), overlap(line, match) > 0.5 {
                    if match.text != line.text { line.corrected = String(match.text.prefix(10000)) }
                } else { line.corrected = "" } // No matching line in the checking pass.
                return line
            }
        }
        pages.append(Page(page:1,lines:lines,width:image.width,height:image.height,orientation:orientation,correction_checked:correctionChecked));truncated = lines.reduce(0) { $0 + $1.text.utf8.count } > 512000
    }
    let output = try JSONEncoder().encode(Output(pages:pages,total:total,truncated:truncated))
    guard output.count <= 3000000 else { throw NSError(domain: "Output limit", code: 1) }
    FileHandle.standardOutput.write(output)
} catch { FileHandle.standardError.write(Data("Local OCR unavailable\n".utf8));exit(1) }
