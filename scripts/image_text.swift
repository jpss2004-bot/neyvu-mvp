import Foundation
import Vision
import AppKit
guard CommandLine.arguments.count == 2, let image = NSImage(contentsOfFile: CommandLine.arguments[1]), let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cgImage)
do {
    try handler.perform([request])
    for result in request.results ?? [] {
        if let text = result.topCandidates(1).first?.string { print(text) }
    }
} catch { exit(1) }
