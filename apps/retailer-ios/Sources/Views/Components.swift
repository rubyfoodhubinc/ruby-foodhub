import SwiftUI
import SafariServices

// MARK: - Flow layout (flex-wrap)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > 0 && x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0; lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: min(widest, maxWidth), height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX; lineHeight = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

// MARK: - Pills (.pill-*)

enum PillTone { case green, amber, blue, gray
    var bg: Color {
        switch self { case .green: return Brand.greenBG; case .amber: return Brand.amberBG; case .blue: return Brand.blueBG; case .gray: return Brand.ink(0.08) }
    }
    var fg: Color {
        switch self { case .green: return Brand.greenFG; case .amber: return Brand.amberFG; case .blue: return Brand.blueFG; case .gray: return Brand.ink(0.6) }
    }
}

struct Pill: View {
    let text: String
    let tone: PillTone
    init(_ text: String, _ tone: PillTone) { self.text = text; self.tone = tone }
    var body: some View {
        Text(text)
            .font(.caption.weight(.bold))
            .foregroundStyle(tone.fg)
            .padding(.vertical, 4).padding(.horizontal, 10)
            .background(tone.bg, in: Capsule())
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Notice banner (.notice / .notice.good)

struct NoticeView: View {
    let markdown: String
    var good = false
    var body: some View {
        Text(Self.attributed(markdown))
            .font(.subheadline)
            .lineSpacing(3)
            .foregroundStyle(good ? Brand.greenFG : Brand.amberFG)
            .tint(Brand.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 14).padding(.horizontal, 16)
            .background(good ? Brand.goodBG : Brand.amberBG, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .fixedSize(horizontal: false, vertical: true)
    }
    static func attributed(_ md: String) -> AttributedString {
        (try? AttributedString(markdown: md, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(md)
    }
}

// MARK: - KPI card (.kpi-card)

struct KPICard: View {
    let label: String
    let value: String
    var sub: String? = nil
    var valueFont: Font = .title2.weight(.heavy)
    var link: (title: String, action: () -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2).tracking(0.6)
                .foregroundStyle(Brand.label)
                .padding(.bottom, 2)
            Text(value)
                .font(valueFont)
                .foregroundStyle(Brand.text)
                .minimumScaleFactor(0.6)
                .lineLimit(2)
            if let sub {
                Text(sub)
                    .font(.caption)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let link {
                Button(link.title, action: link.action)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Brand.primary)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 16).padding(.horizontal, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: Brand.ink(0.06), radius: 7, x: 0, y: 4)
        .accessibilityElement(children: .combine)
    }
}

/// .kpi-grid — repeat(auto-fit, minmax(180px, 1fr)) equivalent.
/// Like CSS auto-fit, wide layouts stretch the cards across the row (`count` columns).
struct KPIGrid<Content: View>: View {
    var minimum: CGFloat = 150
    var count: Int = 3
    @ViewBuilder var content: () -> Content
    @Environment(\.horizontalSizeClass) private var hSize
    private var columns: [GridItem] {
        hSize == .regular
            ? Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count)
            : [GridItem(.adaptive(minimum: minimum), spacing: 12, alignment: .top)]
    }
    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            content()
        }
    }
}

// MARK: - Avatar (.avatar-lg / .avatar-placeholder)

struct AccountAvatar: View {
    let account: Account
    var size: CGFloat = 84
    var lineWidth: CGFloat = 2.5
    var borderColor: Color = Brand.primary

    var body: some View {
        Group {
            if let s = account.logo_url, let url = URL(string: s) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Color.white
                    }
                }
            } else {
                ZStack {
                    Brand.avatarPlaceholderBG
                    Text(initial)
                        .font(.system(size: size / 3, weight: .heavy))
                        .foregroundStyle(Brand.primary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(borderColor, lineWidth: lineWidth))
        .accessibilityLabel(account.logo_url != nil ? "\(account.business_name) logo" : "\(account.business_name) logo placeholder")
    }

    var initial: String {
        let t = account.business_name.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "?" : String(t.prefix(1)).uppercased()
    }
}

// MARK: - Table → stacked cards on phones (the .table-stack layout)

struct TableCell: Identifiable {
    let id = UUID()
    let view: AnyView
    var nowrap = false
    init<V: View>(nowrap: Bool = false, @ViewBuilder _ v: () -> V) { self.view = AnyView(v()); self.nowrap = nowrap }
    init(_ text: String, bold: Bool = false, nowrap: Bool = false) {
        self.nowrap = nowrap
        self.view = AnyView(Text(text).font(.subheadline.weight(bold ? .bold : .regular)).fixedSize(horizontal: false, vertical: true))
    }
}

struct TableRow: Identifiable {
    let id: String
    let cells: [TableCell]
}

struct DataTable: View {
    let headers: [String]
    let rows: [TableRow]
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        if hSize == .regular { wide.environment(\.cellAlignment, .leading) } else { stacked }
    }

    /// Phone layout: each row becomes a labelled card.
    private var stacked: some View {
        VStack(spacing: 12) {
            ForEach(rows) { row in
                VStack(spacing: 0) {
                    ForEach(Array(row.cells.enumerated()), id: \.offset) { i, cell in
                        let label = i < headers.count ? headers[i] : ""
                        Group {
                            if label.isEmpty {
                                HStack { Spacer(); cell.view }
                                    .padding(.top, 10).padding(.bottom, 7)
                            } else {
                                HStack(alignment: .firstTextBaseline, spacing: 16) {
                                    Text(label.uppercased())
                                        .font(.caption2).tracking(0.5)
                                        .foregroundStyle(Brand.label)
                                        .fixedSize()
                                    Spacer(minLength: 0)
                                    cell.view.multilineTextAlignment(.trailing)
                                }
                                .padding(.vertical, 7)
                            }
                        }
                        if i < row.cells.count - 1 {
                            Rectangle().fill(Brand.ink(0.06)).frame(height: 1)
                        }
                    }
                }
                .padding(.vertical, 6).padding(.horizontal, 14)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.ink(0.12), lineWidth: 1.5))
                .accessibilityElement(children: .contain)
            }
        }
    }

    /// iPad / wide layout: a real table.
    private var wide: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(headers.enumerated()), id: \.offset) { _, h in
                    Text(h.uppercased())
                        .font(.caption2).tracking(0.5)
                        .foregroundStyle(Brand.label)
                        .lineLimit(1).fixedSize()
                        .padding(.vertical, 11)
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                GridRow(alignment: .firstTextBaseline) {
                    ForEach(row.cells) { cell in
                        cell.view
                            .fixedSize(horizontal: cell.nowrap, vertical: false)
                            .padding(.vertical, 11)
                    }
                }
                if idx < rows.count - 1 {
                    Rectangle().fill(Brand.ink(0.08)).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                }
            }
        }
    }
}

struct EmptyState: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Brand.label)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
    }
}

// MARK: - Safari view for Stripe Checkout

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Brand.primary)
        vc.dismissButtonStyle = .done
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// Centers content at the web's 960px max width with 20pt gutters.
struct PageColumn<Content: View>: View {
    var maxWidth: CGFloat = 960
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) { content() }
            .frame(maxWidth: maxWidth)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 60)
            .frame(maxWidth: .infinity)
    }
}

// MARK: - Cell alignment: right-aligned in stacked phone cards, left in wide tables

private struct CellAlignmentKey: EnvironmentKey { static let defaultValue: HorizontalAlignment = .trailing }
extension EnvironmentValues {
    var cellAlignment: HorizontalAlignment {
        get { self[CellAlignmentKey.self] }
        set { self[CellAlignmentKey.self] = newValue }
    }
}

/// A multi-line table cell whose lines follow the table's alignment.
struct CellVStack<Content: View>: View {
    @Environment(\.cellAlignment) private var alignment
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: alignment, spacing: 4) { content() }
            .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
    }
}
