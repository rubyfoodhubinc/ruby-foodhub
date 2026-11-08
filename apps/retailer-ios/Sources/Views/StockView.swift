import SwiftUI

/// #view-stock — on-hand quantities and "Record Sold".
struct StockView: View {
    @EnvironmentObject var store: PortalStore
    @State private var soldText: [String: String] = [:]
    @State private var confirm: (productId: String, qty: Int)?
    @State private var alertText: String?
    @State private var busy: Set<String> = []

    private var sorted: [StockRow] {
        store.stock.sorted { ($0.name + $0.variant).localizedCompare($1.name + $1.variant) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("My Stock")
            NoteText("Quantities on hand at your location, updated when Ruby FoodHub fulfills your orders or records an adjustment. Running low? Place a new order.")
            if !store.stockLoaded {
                EmptyState("Loading…")
            } else if let err = store.stockError {
                EmptyState(err)
            } else if store.stock.isEmpty {
                EmptyState("No stock recorded yet — quantities appear here after your first order is fulfilled.")
            } else {
                NoteText("Sold some product? Record it below — daily, weekly, or as it happens — so your on-hand counts stay accurate. Deliveries from Ruby FoodHub are added automatically when your orders are fulfilled.")
                DataTable(headers: ["Product", "Variant", "Qty on Hand", "Status", "Updated", "Report Sales"], rows: sorted.map { s in
                    TableRow(id: s.product_id, cells: [
                        TableCell(s.name),
                        TableCell(s.variant),
                        TableCell("\(s.quantity)", bold: true),
                        TableCell { StockBadge(qty: s.quantity) },
                        TableCell(Fmt.dateTime(s.updated_at), nowrap: true),
                        TableCell(nowrap: true) { reportCell(s) },
                    ])
                })
                if !store.movements.isEmpty {
                    SectionTitle("Recent Stock Activity").padding(.top, 8)
                    DataTable(headers: ["Date", "Product", "Change", "Note"], rows: store.movements.map { m in
                        TableRow(id: m.id.uuidString, cells: [
                            TableCell(Fmt.dateTime(m.created_at), nowrap: true),
                            TableCell(m.products.map { "\($0.name) — \($0.variant)" } ?? "—"),
                            TableCell((m.change >= 0 ? "+" : "") + "\(m.change)", bold: true),
                            TableCell((m.note?.isEmpty == false ? m.note! : "—")),
                        ])
                    })
                }
            }
        }
        .card()
        .task { await store.loadStock() }
        .alert("Record Sold", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button("Cancel", role: .cancel) { confirm = nil }
            Button("Record") { if let c = confirm { record(c.productId, c.qty) } }
        } message: {
            let q = confirm?.qty ?? 0
            Text("Record \(q) unit(s) sold? Your on-hand stock will be reduced by \(q).")
        }
        .alert("My Stock", isPresented: Binding(get: { alertText != nil }, set: { if !$0 { alertText = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(alertText ?? "") }
    }

    @ViewBuilder private func reportCell(_ s: StockRow) -> some View {
        if s.quantity > 0 {
            HStack(spacing: 6) {
                TextField("qty", text: Binding(get: { soldText[s.product_id] ?? "" },
                                               set: { soldText[s.product_id] = $0.filter(\.isNumber) }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.subheadline)
                    .frame(width: 64)
                    .padding(.vertical, 6).padding(.horizontal, 8)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Brand.ink(0.18), lineWidth: 1.5))
                    .accessibilityLabel("Units sold of \(s.name) \(s.variant)")
                Button("Record Sold") {
                    hideKeyboard()
                    let qty = Int(soldText[s.product_id] ?? "") ?? 0
                    if qty <= 0 { alertText = "Enter how many units were sold."; return }
                    confirm = (s.product_id, qty)
                }
                .buttonStyle(.outlineSmall)
                .disabled(busy.contains(s.product_id))
            }
        } else {
            Text("—").font(.subheadline)
        }
    }

    private func record(_ productId: String, _ qty: Int) {
        confirm = nil
        busy.insert(productId)
        Task {
            do {
                try await store.reportSold(productId: productId, quantity: qty)
                soldText[productId] = ""
            } catch {
                alertText = "Could not record: " + error.localizedDescription
            }
            busy.remove(productId)
        }
    }
}
