// Offline device reader. Stdin is the original, stdout a bounded observation.
// No URLs, network calls, file output, language correction or semantic repair.
import Foundation
import PDFKit
import Vision
import AppKit
import CryptoKit

struct Box: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
struct NativeLine: Codable { let text: String; let box: Box }
struct OCRLine: Codable { let text: String; let confidence: Float; let box: Box }
struct ObservedPage: Codable {
    let number: Int; let pdf_label: String?; let width: Double; let height: Double; let origin_x: Double; let origin_y: Double; let rotation: Int
    let native_text: String; let native_lines: [NativeLine]
    let ocr_status: String; let ocr_lines: [OCRLine]
    enum CodingKeys:String,CodingKey { case number,pdf_label,width,height,origin_x,origin_y,rotation,native_text,native_lines,ocr_status,ocr_lines }
    func encode(to encoder:Encoder) throws {
        var c=encoder.container(keyedBy:CodingKeys.self)
        try c.encode(number,forKey:.number);try c.encode(pdf_label,forKey:.pdf_label)
        try c.encode(width,forKey:.width);try c.encode(height,forKey:.height)
        try c.encode(origin_x,forKey:.origin_x);try c.encode(origin_y,forKey:.origin_y);try c.encode(rotation,forKey:.rotation)
        try c.encode(native_text,forKey:.native_text);try c.encode(native_lines,forKey:.native_lines)
        try c.encode(ocr_status,forKey:.ocr_status);try c.encode(ocr_lines,forKey:.ocr_lines)
    }
}
struct Observation: Codable {
    let format: String; let version: String; let original_sha256: String
    let page_count: Int; let pages: [ObservedPage]; let languages: [String]
    let native_coordinates: String; let ocr_coordinates: String; let language_correction: Bool
}
func box(_ r: CGRect) -> Box { Box(x:Double(r.origin.x),y:Double(r.origin.y),width:Double(r.width),height:Double(r.height)) }
func problem(_ code: Int) -> NSError { NSError(domain:"Neyvu local PDF",code:code) }
do {
    guard CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "pdf-v1" else { throw problem(1) }
    let raw = FileHandle.standardInput.readData(ofLength:10*1024*1024+1)
    guard raw.count >= 5 && raw.count <= 10*1024*1024 && raw.prefix(5) == Data("%PDF-".utf8) else { throw problem(2) }
    guard let doc = PDFDocument(data:raw), !doc.isLocked || doc.unlock(withPassword:"") else { throw problem(3) }
    guard doc.pageCount > 0 && doc.pageCount <= 500 else { throw problem(4) }
    let probe = VNRecognizeTextRequest();probe.recognitionLevel = .accurate
    let supported = (try? probe.supportedRecognitionLanguages()) ?? []
    let languages = ["en-US","es-ES"].filter { supported.contains($0) }
    let started = Date(); var pages:[ObservedPage] = []; var textBytes = 0; var lines = 0
    for i in 0..<doc.pageCount {
        let observed:ObservedPage = try autoreleasepool {
            guard let page=doc.page(at:i) else { throw problem(5) }
            let bounds=page.bounds(for:.mediaBox)
            guard bounds.width.isFinite && bounds.height.isFinite && bounds.width>0 && bounds.height>0 && bounds.width<=20000 && bounds.height<=20000 else { throw problem(6) }
            let native=page.string ?? ""
            let nativeLines = (page.selection(for:bounds)?.selectionsByLine() ?? []).compactMap { selection -> NativeLine? in
                guard let text=selection.string, !text.isEmpty else { return nil }
                return NativeLine(text:text,box:box(selection.bounds(for:page)))
            }
            var status="unavailable";var ocr:[OCRLine]=[]
            if Date().timeIntervalSince(started)>60 { status="budget" }
            else if !languages.isEmpty {
                do {
                    let scale=min(2.5,2200/max(bounds.width,bounds.height))
                    let image=page.thumbnail(of:NSSize(width:bounds.width*scale,height:bounds.height*scale),for:.mediaBox)
                    guard let cg=image.cgImage(forProposedRect:nil,context:nil,hints:nil) else { throw problem(7) }
                    let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate
                    request.recognitionLanguages=languages;request.usesLanguageCorrection=false
                    if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage=true }
                    try VNImageRequestHandler(cgImage:cg).perform([request])
                    ocr=(request.results ?? []).compactMap { line -> OCRLine? in
                        guard let best=line.topCandidates(1).first, !best.string.isEmpty else { return nil }
                        return OCRLine(text:best.string,confidence:best.confidence,box:box(line.boundingBox))
                    };status="ok"
                } catch { status="error" }
            }
            textBytes += native.utf8.count + ocr.reduce(0) { $0+$1.text.utf8.count }
            lines += nativeLines.count + ocr.count
            guard textBytes<=512000 && lines<=20000 else { throw problem(8) }
            return ObservedPage(number:i+1,pdf_label:page.label,width:Double(bounds.width),height:Double(bounds.height),origin_x:Double(bounds.origin.x),origin_y:Double(bounds.origin.y),rotation:page.rotation,native_text:native,native_lines:nativeLines,ocr_status:status,ocr_lines:ocr)
        }
        pages.append(observed)
    }
    let sha=SHA256.hash(data:raw).map { String(format:"%02x",$0) }.joined()
    let value=Observation(format:"neyvu-native-pdf/1",version:"1",original_sha256:sha,page_count:doc.pageCount,pages:pages,languages:languages,native_coordinates:"pdf_points_bottom_left",ocr_coordinates:"normalized_bottom_left",language_correction:false)
    let output=try JSONEncoder().encode(value);guard output.count<=3000000 else { throw problem(9) }
    FileHandle.standardOutput.write(output)
} catch { FileHandle.standardError.write(Data("Neyvu native PDF observation unavailable\n".utf8));exit(1) }
