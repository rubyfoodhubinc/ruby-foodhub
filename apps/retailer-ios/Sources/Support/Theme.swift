import SwiftUI

/// Brand palette: the oklch() colours from retailer.html, converted to sRGB.
enum Brand {
    /// oklch(45% 0.17 20) — ruby red, buttons/links/active pills
    static let primary = Color(hex: 0x9E122B)
    /// oklch(52% 0.19 20) — pressed/hover state
    static let primaryPressed = Color(hex: 0xBE2038)
    /// oklch(97% 0.015 60) — page background
    static let background = Color(hex: 0xFDF3EB)
    /// oklch(22% 0.02 40) — body text
    static let text = Color(hex: 0x231814)
    /// rgba(34,30,26,a) — the "ink" used for borders and muted text
    static func ink(_ alpha: Double) -> Color { Color(red: 34/255, green: 30/255, blue: 26/255).opacity(alpha) }

    static let amberBG = Color(hex: 0xFFE3BC)   // oklch(93% 0.06 75)
    static let amberFG = Color(hex: 0x663E00)   // oklch(40% 0.1 75)
    static let goodBG = Color(hex: 0xD5F5DA)    // oklch(94% 0.05 150)
    static let greenBG = Color(hex: 0xB9EEC2)   // oklch(90% 0.08 150)
    static let greenFG = Color(hex: 0x00481B)   // oklch(35% 0.1 150)
    static let blueBG = Color(hex: 0xCCE8FF)    // oklch(92% 0.05 250)
    static let blueFG = Color(hex: 0x124A7B)    // oklch(40% 0.1 250)
    static let barTrack = Color(hex: 0xF7F0EB)  // oklch(96% 0.01 60)
    static let avatarPlaceholderBG = Color(hex: 0xFFEDEC) // oklch(96% 0.02 20)
    static let selectedBG = Color(hex: 0xFFF0EF)          // oklch(97% 0.02 20)
    static let deleteBorder = Color(hex: 0xCC272E)        // oklch(55% 0.2 25)
    static let deleteText = Color(hex: 0xB30018)          // oklch(48% 0.2 25)

    static let muted = ink(0.55)
    static let label = ink(0.5)

    /// Base URL of the live site. The only network constant in the app.
    static let baseURL = URL(string: "https://www.rubyfoodhub.com")!
    static let privacyURL = URL(string: "https://www.rubyfoodhub.com/privacy")!
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

// MARK: - Cards

struct CardModifier: ViewModifier {
    var padding: CGFloat = 22
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Brand.ink(0.07), radius: 9, x: 0, y: 6)
    }
}

extension View {
    func card(padding: CGFloat = 22) -> some View { modifier(CardModifier(padding: padding)) }
}

// MARK: - Buttons (.btn, .btn-outline, .btn-sm)

struct PillButtonStyle: ButtonStyle {
    enum Kind { case filled, outline, danger }
    var kind: Kind = .filled
    var small = false
    var fullWidth = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let fg: Color
        let bg: Color
        let border: Color
        switch kind {
        case .filled:
            fg = .white
            bg = isEnabled ? (pressed ? Brand.primaryPressed : Brand.primary) : Color(white: 0.8)
            border = .clear
        case .outline:
            fg = pressed ? .white : (isEnabled ? Brand.primary : Color(white: 0.6))
            bg = pressed ? Brand.primary : .clear
            border = isEnabled ? Brand.primary : Color(white: 0.75)
        case .danger:
            fg = pressed ? .white : Brand.deleteText
            bg = pressed ? Brand.deleteText : .clear
            border = Brand.deleteBorder
        }
        return configuration.label
            .font(small ? .footnote.weight(.bold) : .subheadline.weight(.bold))
            .multilineTextAlignment(.center)
            .foregroundStyle(fg)
            .padding(.vertical, small ? 8 : 12)
            .padding(.horizontal, small ? 14 : 20)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: small ? 34 : 44)
            .background(bg, in: Capsule())
            .overlay(Capsule().strokeBorder(border, lineWidth: 1.5))
            .contentShape(Capsule())
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var pill: PillButtonStyle { PillButtonStyle() }
    static var pillFull: PillButtonStyle { PillButtonStyle(fullWidth: true) }
    static var pillSmall: PillButtonStyle { PillButtonStyle(small: true) }
    static var outline: PillButtonStyle { PillButtonStyle(kind: .outline) }
    static var outlineSmall: PillButtonStyle { PillButtonStyle(kind: .outline, small: true) }
    static var outlineFull: PillButtonStyle { PillButtonStyle(kind: .outline, fullWidth: true) }
    static var dangerSmall: PillButtonStyle { PillButtonStyle(kind: .danger, small: true) }
}

// MARK: - Inputs

struct BrandFieldStyle: ViewModifier {
    var disabled = false
    func body(content: Content) -> some View {
        content
            .font(.body)
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .background(disabled ? Color(white: 0.96) : Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.ink(0.18), lineWidth: 1.5))
            .foregroundStyle(disabled ? Brand.muted : Brand.text)
    }
}

extension View {
    func brandField(disabled: Bool = false) -> some View { modifier(BrandFieldStyle(disabled: disabled)) }
}

/// .form-label — small uppercase heading above a field.
struct FormLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.heavy))
            .tracking(0.6)
            .foregroundStyle(Brand.label)
            .padding(.bottom, 2)
    }
}

/// .note — small muted paragraph.
struct NoteText: View {
    let text: String
    var alignment: TextAlignment = .leading
    init(_ text: String, alignment: TextAlignment = .leading) { self.text = text; self.alignment = alignment }
    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Brand.ink(0.6))
            .multilineTextAlignment(alignment)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// h2 inside cards.
struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.headline.weight(.bold))
            .foregroundStyle(Brand.text)
            .accessibilityAddTraits(.isHeader)
    }
}
