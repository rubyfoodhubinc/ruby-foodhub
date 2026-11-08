import SwiftUI

/// #view-order — "Place a Wholesale Order".
struct PlaceOrderView: View {
    @EnvironmentObject var store: PortalStore
    @State private var method: PayMethod = .stripe
    @State private var note = ""
    @State private var placing = false
    @State private var confirming = false
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("Place a Wholesale Order")
            if !store.catalogLoaded {
                EmptyState("Loading wholesale catalog…")
            } else if let err = store.catalogError {
                EmptyState(err)
            } else if store.catalog.isEmpty {
                EmptyState("No wholesale products are available yet — check back soon.")
            } else {
                DataTable(headers: ["Product", "Variant", "Wholesale Price", "Quantity"], rows: store.catalog.map { c in
                    TableRow(id: c.product_id, cells: [
                        TableCell(c.name),
                        TableCell(c.variant),
                        TableCell(Fmt.money(c.wholesale_price), bold: true, nowrap: true),
                        TableCell { QuantityField(productId: c.product_id, label: "\(c.name) \(c.variant) quantity") },
                    ])
                })
            }

            Text("Total: " + Fmt.money(store.orderTotal))
                .font(.title3.weight(.heavy))
                .padding(.vertical, 4)
                .accessibilityAddTraits(.updatesFrequently)

            if hSize == .regular {
                HStack(alignment: .top, spacing: 12) { choices }.fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 12) { choices }
            }

            Button(placing ? "Placing order…" : "Place Order") { tapPlace() }
                .buttonStyle(.pill)
                .disabled(placing)
            if !note.isEmpty { NoteText(note) }
        }
        .card()
        .task { if !store.catalogLoaded { await store.loadCatalog() } }
        .alert("Place Order", isPresented: $confirming) {
            Button("Cancel", role: .cancel) {}
            Button("Place Order") { place() }
        } message: {
            Text(confirmText)
        }
    }

    @ViewBuilder private var choices: some View {
        PayChoice(method: .stripe, selected: $method, title: "Pay now via Stripe",
                  detail: Text("Card payment — order confirms immediately."))
        PayChoice(method: .zelle, selected: $method, title: "Pay by Zelle",
                  detail: Text("Send payment to ") + Text(verbatim: "bankpay@rubyfoodhub.com").bold() + Text(" — we show the details after you place the order, then you report the payment for our team to confirm."))
        PayChoice(method: .cash, selected: $method, title: "Pay by cash on delivery",
                  detail: Text("Order submits now; pay our team in cash when your delivery arrives."))
    }

    private var confirmText: String {
        let tail: String
        switch method {
        case .stripe: tail = " and pay now via Stripe?"
        case .zelle: tail = " and pay by Zelle? Our Zelle details are shown right after you place the order."
        case .cash: tail = ", to be paid in cash on delivery?"
        }
        return "Place wholesale order for " + Fmt.money(store.orderTotal) + tail
    }

    private func tapPlace() {
        note = ""
        hideKeyboard()
        guard !store.orderItems.isEmpty else { note = "Enter a quantity for at least one product."; return }
        confirming = true
    }

    private func place() {
        placing = true
        Task {
            note = await store.placeOrder(method: method) ?? ""
            placing = false
        }
    }
}

/// Number box bound to the store's quantity map (0…1000).
struct QuantityField: View {
    @EnvironmentObject var store: PortalStore
    let productId: String
    let label: String
    @State private var text = "0"

    var body: some View {
        TextField("0", text: $text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            .font(.body)
            .frame(width: 80)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Brand.ink(0.18), lineWidth: 1.5))
            .accessibilityLabel(label)
            .onAppear { text = String(store.quantities[productId] ?? 0) }
            .onChange(of: text) { _, new in
                let digits = new.filter(\.isNumber)
                let n = min(1000, Int(digits) ?? 0)
                if digits != new { text = digits }
                store.quantities[productId] = n
            }
            .onChange(of: store.quantities[productId]) { _, q in
                if q == nil { text = "0" }
            }
    }
}

/// .pay-choice label — radio card.
struct PayChoice: View {
    let method: PayMethod
    @Binding var selected: PayMethod
    let title: String
    let detail: Text

    var body: some View {
        let on = selected == method
        Button { selected = method } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(on ? Brand.primary : Brand.ink(0.4))
                    .font(.body)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.bold)).foregroundStyle(Brand.text)
                    detail.font(.footnote).foregroundStyle(Brand.ink(0.6))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 14).padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(on ? Brand.selectedBG : .white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? Brand.primary : Brand.ink(0.18), lineWidth: 1.5))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }
}

extension View {
    func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
