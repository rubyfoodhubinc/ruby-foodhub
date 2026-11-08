import SwiftUI

/// #view-dashboard — "Your Orders".
struct OrdersView: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("Your Orders")
            if !store.ordersLoaded {
                EmptyState("Loading…")
            } else if let err = store.ordersError {
                EmptyState(err)
            } else if store.orders.isEmpty {
                EmptyState("No orders yet — place your first wholesale order.")
            } else {
                DataTable(headers: ["Date", "Order #", "Items", "Total", "Method", "Payment", "Status", ""],
                          rows: store.orders.map { o in
                    TableRow(id: o.id, cells: [
                        TableCell(Fmt.dateTime(o.created_at), nowrap: true),
                        TableCell(o.order_number, nowrap: true),
                        TableCell {
                            CellVStack {
                                Text(o.itemsSummary).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                                if let b = o.production_batch, !b.isEmpty {
                                    Text("Batch: " + b).font(.caption).foregroundStyle(Brand.ink(0.6))
                                }
                            }
                        },
                        TableCell(Fmt.money(o.total), bold: true, nowrap: true),
                        TableCell(OrderPills.methodLabel(o.payment_method)),
                        TableCell { OrderPills.payment(o) },
                        TableCell { OrderPills.status(o) },
                    ] + (o.canPay ? [TableCell(nowrap: true) { PayNowButton(order: o) }] : []))
                })
            }
        }
        .card()
        .task { if !store.ordersLoaded { await store.loadOrders() } }
    }
}

/// openPayModal(order): card via Stripe, Zelle (ID + QR tag), or report cash/Zelle.
struct PayChooserSheet: View {
    @EnvironmentObject var store: PortalStore
    @Environment(\.dismiss) private var dismiss
    let order: Order

    @State private var reference = ""
    @State private var redirecting = false
    @State private var claiming = false
    @State private var pendingClaim: String?
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Pay order \(order.order_number)")
                    .font(.headline.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, 4)
                (Text("Total due: ") + Text(Fmt.money(order.total)).bold())
                    .font(.footnote).foregroundStyle(Brand.ink(0.6))
                    .padding(.bottom, 16)

                Button(redirecting ? "Redirecting…" : "Pay Online Now (Card via Stripe)") { payByCard() }
                    .buttonStyle(.pillFull)
                    .disabled(redirecting)
                    .padding(.bottom, 12)

                Rectangle().fill(Brand.ink(0.12)).frame(height: 1).padding(.bottom, 12)

                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Pay by Zelle").font(.subheadline.weight(.bold))
                        (Text("Send ") + Text(Fmt.money(order.total)).bold() + Text(" to our Zelle ID:\n")
                         + Text(verbatim: "bankpay@rubyfoodhub.com").bold() + Text("\n(Ruby Foodhub Inc)"))
                            .font(.footnote).foregroundStyle(Brand.ink(0.6))
                            .fixedSize(horizontal: false, vertical: true)
                        NoteText("Or scan the Zelle tag with your banking app.")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image("ZelleTag")
                        .resizable().scaledToFit()
                        .frame(width: 132)
                        .padding(6)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Brand.ink(0.12), lineWidth: 1))
                        .accessibilityLabel("Zelle QR tag — Ruby Foodhub Inc")
                }

                (Text("Once you've sent the Zelle payment (or paid our team in cash), report it below. The order will show as ")
                 + Text("Awaiting Confirmation").bold()
                 + Text(" until our team verifies the payment — it clears only once confirmed."))
                    .font(.footnote).foregroundStyle(Brand.ink(0.6))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10).padding(.bottom, 8)

                TextField("Reference (optional — e.g. Zelle confirmation #)", text: $reference)
                    .font(.subheadline)
                    .padding(.vertical, 9).padding(.horizontal, 12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Brand.ink(0.18), lineWidth: 1.5))
                    .padding(.bottom, 10)

                HStack(spacing: 8) {
                    Button("I Paid by Cash") { pendingClaim = "cash" }
                        .buttonStyle(.outlineFull)
                    Button("I Paid by Zelle") { pendingClaim = "zelle" }
                        .buttonStyle(.outlineFull)
                }
                .disabled(claiming)
                .padding(.bottom, 12)

                Button("Cancel") { dismiss() }
                    .buttonStyle(PillButtonStyle(kind: .outline, small: true, fullWidth: true))
            }
            .padding(24)
            .foregroundStyle(Brand.text)
        }
        .background(Color.white)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .alert("Report payment?", isPresented: Binding(get: { pendingClaim != nil }, set: { if !$0 { pendingClaim = nil } })) {
            Button("Cancel", role: .cancel) { pendingClaim = nil }
            Button("Report Payment") {
                if let m = pendingClaim { claim(m) }
            }
        } message: {
            let label = pendingClaim == "zelle" ? "Zelle" : "cash"
            Text("Report that you already paid \(Fmt.money(order.total)) for order \(order.order_number) by \(label)? Our team will verify it — the order shows as Awaiting Confirmation until then.")
        }
        .alert("Payment", isPresented: Binding(get: { errorText != nil }, set: { if !$0 { errorText = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(errorText ?? "") }
    }

    private func payByCard() {
        redirecting = true
        Task {
            do { try await store.payByCard(order) }
            catch {
                errorText = "Payment failed: " + error.localizedDescription
                redirecting = false
            }
        }
    }

    private func claim(_ method: String) {
        pendingClaim = nil
        claiming = true
        Task {
            do { try await store.claimPayment(order, method: method, reference: reference) }
            catch {
                errorText = "Could not report payment: " + error.localizedDescription
                claiming = false
            }
        }
    }
}
