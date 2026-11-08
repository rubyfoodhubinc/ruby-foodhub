import SwiftUI

/// #view-home — KPI dashboard.
struct HomeView: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            hero
            if let err = store.homeError {
                EmptyState(err)
            } else {
                KPIGrid(count: 4) { mainKPIs }
                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle("Order Pipeline")
                    KPIGrid {
                        KPICard(label: "Pending", value: "\(counts.pending)", sub: "awaiting confirmation")
                        KPICard(label: "Confirmed", value: "\(counts.confirmed)", sub: "being prepared")
                        KPICard(label: "Fulfilled", value: "\(counts.fulfilled)", sub: "delivered to you")
                    }
                }
                .card()
                stockHealth.card()
                monthly.card()
                recent.card()
            }
        }
        .task { if !store.ordersLoaded { await store.loadHome() } }
    }

    // MARK: Hero

    private var hero: some View {
        let account = store.account
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 18) {
                if let account { AccountAvatar(account: account) }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Welcome, \(account?.business_name ?? "")")
                        .font(.title3.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(sinceText).font(.footnote).foregroundStyle(Brand.ink(0.6))
                }
                .accessibilityElement(children: .combine)
            }
            FlowLayout(spacing: 10, lineSpacing: 10) {
                Button("Place New Order") { store.show(.order) }.buttonStyle(.pillSmall)
                Button("Check My Stock") { store.show(.stock) }.buttonStyle(.outlineSmall)
                Button("Update Profile") { store.show(.profile) }.buttonStyle(.outlineSmall)
            }
        }
        .card()
    }

    private var sinceText: String {
        if let m = Fmt.monthYearLong(store.account?.created_at) { return "Ruby FoodHub wholesale partner since " + m }
        return "Ruby FoodHub wholesale partner"
    }

    // MARK: KPIs

    private var live: [Order] { store.orders.filter { !$0.isCanceled } }
    private func sum(_ list: [Order]) -> Double { list.reduce(0) { $0 + $1.total } }

    @ViewBuilder private var mainKPIs: some View {
        let awaiting = live.filter { $0.payment_status == "awaiting_confirmation" }
        let owed = live.filter { $0.payment_status == "pending" } + awaiting
        let last = live.first
        KPICard(label: "Total Ordered (All-Time)", value: Fmt.money(sum(live)), sub: "\(live.count) order(s)")
        if owed.isEmpty {
            KPICard(label: "Amount Due", value: Fmt.money(0), sub: "nothing outstanding")
        } else {
            KPICard(label: "Amount Due", value: Fmt.money(sum(owed)),
                    sub: "\(owed.count - awaiting.count) unpaid" + (awaiting.isEmpty ? "" : " · \(awaiting.count) awaiting confirmation"),
                    link: ("view orders", { store.show(.dashboard) }))
        }
        KPICard(label: "Last Order", value: last.map { Fmt.dateTime($0.created_at) } ?? "—",
                sub: last.map { "\($0.order_number) · \(Fmt.money($0.total))" } ?? "place your first order",
                valueFont: .title3.weight(.heavy))
        KPICard(label: "Products Stocked", value: "\(store.stock.filter { $0.quantity > 0 }.count)",
                sub: "of \(store.stock.count) tracked at your location")
    }

    private var counts: (pending: Int, confirmed: Int, fulfilled: Int) {
        (live.filter { $0.order_status == "pending" }.count,
         live.filter { $0.order_status == "confirmed" }.count,
         live.filter { $0.order_status == "fulfilled" }.count)
    }

    // MARK: Stock health

    private var stockHealth: some View {
        let stock = store.stock
        let low = stock.filter { $0.quantity > 0 && $0.quantity <= 5 }
        let out = stock.filter { $0.quantity <= 0 }
        let attention = Array((out + low).prefix(6))
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Stock Health")
            KPIGrid {
                KPICard(label: "In Stock", value: "\(stock.filter { $0.quantity > 5 }.count)", sub: "healthy")
                KPICard(label: "Running Low", value: "\(low.count)", sub: "5 or fewer on hand")
                KPICard(label: "Out of Stock", value: "\(out.count)", sub: "reorder now")
            }
            if !attention.isEmpty {
                NoteText("Needs attention:")
                VStack(spacing: 0) {
                    ForEach(attention) { s in
                        HStack(spacing: 10) {
                            Text("\(s.name) — \(s.variant)").font(.subheadline)
                            Spacer(minLength: 8)
                            StockBadge(qty: s.quantity)
                        }
                        .padding(.vertical, 6)
                        .overlay(alignment: .bottom) { Rectangle().fill(Brand.ink(0.06)).frame(height: 1) }
                        .accessibilityElement(children: .combine)
                    }
                }
                Button("Reorder Now") { store.show(.order) }.buttonStyle(.pillSmall)
            } else if stock.isEmpty {
                NoteText("Stock tracking starts after your first fulfilled order.")
            }
        }
    }

    // MARK: Monthly spend

    private var months: [(label: String, total: Double)] {
        let cal = Calendar.current
        let now = Date()
        let startOfThisMonth = cal.date(from: cal.dateComponents([.year, .month], from: now))!
        return (0...5).reversed().map { i in
            let start = cal.date(byAdding: .month, value: -i, to: startOfThisMonth)!
            let end = cal.date(byAdding: .month, value: 1, to: start)!
            let total = sum(live.filter { o in
                guard let d = Fmt.parse(o.created_at) else { return false }
                return d >= start && d < end
            })
            return (Fmt.monthShort(start), total)
        }
    }

    private var monthly: some View {
        let ms = months
        let maxMonth = max(1, ms.map(\.total).max() ?? 1)
        return VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Monthly Spend — Last 6 Months").padding(.bottom, 6)
            ForEach(Array(ms.enumerated()), id: \.offset) { _, m in
                HStack(spacing: 10) {
                    Text(m.label).font(.footnote).frame(width: 44, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 6).fill(Brand.barTrack)
                            RoundedRectangle(cornerRadius: 6).fill(Brand.primary)
                                .frame(width: max(2, geo.size.width * CGFloat(max(0.02, m.total / maxMonth))))
                        }
                    }
                    .frame(height: 18)
                    Text(Fmt.money(m.total)).font(.footnote.weight(.bold))
                        .frame(minWidth: 84, alignment: .trailing)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(m.label): \(Fmt.money(m.total))")
            }
        }
    }

    // MARK: Recent orders

    private var recent: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("Recent Orders")
            let recent = Array(store.orders.prefix(5))
            if !store.ordersLoaded {
                EmptyState("Loading…")
            } else if recent.isEmpty {
                VStack(spacing: 6) {
                    Text("No orders yet —").font(.subheadline).foregroundStyle(Brand.label)
                    Button("place your first wholesale order") { store.show(.order) }
                        .font(.subheadline.weight(.bold)).foregroundStyle(Brand.primary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                DataTable(headers: ["Date", "Order #", "Total", "Payment", "Status", ""], rows: recent.map { o in
                    TableRow(id: o.id, cells: [
                        TableCell(Fmt.dateTime(o.created_at), nowrap: true),
                        TableCell(o.order_number, nowrap: true),
                        TableCell(Fmt.money(o.total), bold: true, nowrap: true),
                        TableCell { OrderPills.payment(o) },
                        TableCell { OrderPills.status(o) },
                    ] + (o.canPay ? [TableCell(nowrap: true) { PayNowButton(order: o) }] : []))
                })
            }
        }
    }
}

/// stockBadge(qty)
struct StockBadge: View {
    let qty: Int
    var body: some View {
        if qty <= 0 { Pill("Out of Stock", .gray) }
        else if qty <= 5 { Pill("Low", .amber) }
        else { Pill("In Stock", .green) }
    }
}
