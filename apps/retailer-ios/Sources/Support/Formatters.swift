import Foundation

/// Mirrors the money()/fdate() helpers in retailer.html.
enum Fmt {
    /// money(v): '$' + Number(v || 0).toFixed(2)  (no thousands separator, like the web)
    static func money(_ value: Double?) -> String {
        String(format: "$%.2f", value ?? 0)
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    /// Postgres timestamps can come back with micro-second fractions and/or "+00:00".
    static func parse(_ string: String?) -> Date? {
        guard var s = string, !s.isEmpty else { return nil }
        if let d = iso.date(from: s) ?? isoNoFraction.date(from: s) { return d }
        // Trim fractional seconds beyond milliseconds: 2026-11-01T10:00:00.123456+00:00
        if let dot = s.firstIndex(of: ".") {
            let afterDot = s[s.index(after: dot)...]
            let digits = afterDot.prefix(while: { $0.isNumber })
            let rest = afterDot.dropFirst(digits.count)
            s = String(s[..<dot]) + "." + String(digits.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0) + rest
            if !s.contains("Z") && !s.contains("+") && s.filter({ $0 == "-" }).count == 2 { s += "Z" }
            if let d = iso.date(from: s) { return d }
        } else if !s.hasSuffix("Z") && !s.contains("+") {
            if let d = isoNoFraction.date(from: s + "Z") { return d }
        }
        return nil
    }

    private static let us = Locale(identifier: "en_US")

    /// fdate(v): e.g. "Nov 7, 2026, 3:05 PM", or an em dash when missing.
    static func dateTime(_ string: String?) -> String {
        guard let d = parse(string) else { return "—" }
        return dateTimeFormatter.string(from: d)
    }

    /// Same output as toLocaleString('en-US', {year,month:'short',day,hour,minute:'2-digit'}).
    private static let dateTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d, yyyy, h:mm a"
        return f
    }()

    /// "November 2026" (Home: partner since)
    static func monthYearLong(_ string: String?) -> String? {
        guard let d = parse(string) else { return nil }
        return d.formatted(.dateTime.month(.wide).year().locale(us))
    }

    /// "Nov 2026" (Profile: member since)
    static func monthYearShort(_ string: String?) -> String? {
        guard let d = parse(string) else { return nil }
        return d.formatted(.dateTime.month(.abbreviated).year().locale(us))
    }

    static func monthShort(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).locale(us))
    }
}
