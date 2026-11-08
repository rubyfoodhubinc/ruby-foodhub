import SwiftUI

/// #view-help — contact cards and the support form.
struct HelpView: View {
    @EnvironmentObject var store: PortalStore

    static let topics: [(value: String, label: String)] = [
        ("order_issue", "Order Issue"),
        ("delivery", "Delivery / Scheduling"),
        ("payment", "Payment / Billing"),
        ("product", "Product Question"),
        ("account", "Account / Access"),
        ("other", "General / Other"),
    ]

    @State private var topic = "other"
    @State private var orderNumber = ""
    @State private var subject = ""
    @State private var message = ""
    @State private var note = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Help & Support")
            NoteText("Have a question, an issue with an order, or need a hand? Send the Ruby FoodHub wholesale team a message and we'll reply to your account email. For anything urgent you can also reach us directly.")

            KPIGrid(minimum: 220, count: 2) {
                ContactCard(label: "Email", value: "sales@rubyfoodhub.com", sub: "Wholesale team inbox",
                            url: URL(string: "mailto:sales@rubyfoodhub.com")!, a11y: "Email the wholesale team at sales@rubyfoodhub.com")
                ContactCard(label: "Phone", value: "+1 (660) 460-7261", sub: "Mon–Fri, business hours",
                            url: URL(string: "tel:+16604607261")!, a11y: "Call the wholesale team at +1 660 460 7261")
            }
            .padding(.vertical, 6)

            FormLabel("What do you need help with?")
            Menu {
                Picker("Topic", selection: $topic) {
                    ForEach(Self.topics, id: \.value) { Text($0.label).tag($0.value) }
                }
            } label: {
                HStack {
                    Text(Self.topics.first { $0.value == topic }?.label ?? "")
                        .foregroundStyle(Brand.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(Brand.muted)
                        .accessibilityHidden(true)
                }
                .brandField()
            }
            .accessibilityLabel("What do you need help with? \(Self.topics.first { $0.value == topic }?.label ?? "")")

            FormLabel("Related Order Number (optional)")
            TextField("e.g. WHS-000004", text: $orderNumber)
                .textInputAutocapitalization(.characters).autocorrectionDisabled().brandField()
            FormLabel("Subject")
            TextField("Brief summary", text: $subject).brandField()
            FormLabel("Message")
            TextField("Tell us what's going on and how we can help…", text: $message, axis: .vertical)
                .lineLimit(6...12)
                .brandField()

            Button(sending ? "Sending…" : "Send Message") { send() }
                .buttonStyle(.pill)
                .disabled(sending)
            if !note.isEmpty { NoteText(note) }
        }
        .card()
    }

    private func send() {
        note = ""
        hideKeyboard()
        let s = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !m.isEmpty else { note = "Please add a subject and a message."; return }
        sending = true
        Task {
            do {
                try await store.contactSupport(topic: topic, orderNumber: orderNumber, subject: s, message: m)
                note = "Message sent — we've emailed you a copy and will reply soon."
                subject = ""; message = ""; orderNumber = ""
            } catch {
                note = "Could not send: " + error.localizedDescription
            }
            sending = false
        }
    }
}

struct ContactCard: View {
    let label: String
    let value: String
    let sub: String
    let url: URL
    let a11y: String

    var body: some View {
        Link(destination: url) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label.uppercased()).font(.caption2).tracking(0.6).foregroundStyle(Brand.label).padding(.bottom, 2)
                Text(value).font(.callout.weight(.heavy)).foregroundStyle(Brand.primary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(sub).font(.caption).foregroundStyle(Brand.muted)
            }
            .padding(.vertical, 16).padding(.horizontal, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: Brand.ink(0.06), radius: 7, x: 0, y: 4)
        }
        .accessibilityLabel(a11y)
    }
}
