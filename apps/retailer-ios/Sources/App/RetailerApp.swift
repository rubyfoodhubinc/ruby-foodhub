import SwiftUI

@main
struct RetailerApp: App {
    @StateObject private var store = PortalStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Brand.primary)
                .preferredColorScheme(.light)
                .task { await store.bootstrap() }
                .onChange(of: scenePhase) { _, phase in
                    // Coming back from the bank app / Stripe: refresh order status.
                    if phase == .active && store.safari == nil {
                        Task { await store.refreshAfterReturn() }
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            switch store.phase {
            case .launching:
                ProgressView().tint(Brand.primary)
            case .auth:
                AuthScreen()
            case .portal:
                PortalScreen()
            }
        }
        .foregroundStyle(Brand.text)
        .sheet(item: $store.safari, onDismiss: {
            Task { await store.checkoutFinished() }
        }) { target in
            SafariView(url: target.url).ignoresSafeArea()
        }
    }
}

/// Shared top bar (.topbar): logo, "Ruby FoodHub / Retailer Portal", and when
/// signed in the business avatar, who-am-I and Sign Out.
struct TopBar: View {
    @EnvironmentObject var store: PortalStore
    @Environment(\.horizontalSizeClass) private var hSize
    var signedIn: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image("LogoMarkSmall")
                    .resizable().scaledToFill()
                    .frame(width: 30, height: 30)
                    .clipShape(Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Ruby FoodHub").font(.subheadline.weight(.heavy))
                    Text("Retailer").font(.caption).foregroundStyle(Brand.muted)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 8)
                if signedIn, let account = store.account {
                    if account.logo_url != nil {
                        AccountAvatar(account: account, size: 30, lineWidth: 1.5, borderColor: Brand.ink(0.15))
                    }
                    if hSize == .regular {
                        Text("\(account.business_name) · \(account.email)")
                            .font(.caption).foregroundStyle(Brand.muted).lineLimit(1)
                    }
                    Menu {
                        Button { store.view = .profile } label: { Label("Profile", systemImage: "person.crop.circle") }
                        Link(destination: URL(string: "https://www.rubyfoodhub.com/privacy")!) {
                            Label("Privacy Policy", systemImage: "hand.raised")
                        }
                        Button(role: .destructive) {
                            store.view = .profile
                            store.requestDeleteAccount = true
                        } label: { Label("Delete Account", systemImage: "trash") }
                        Button { Task { await store.logout() } } label: { Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right") }
                    } label: {
                        Image(systemName: "person.crop.circle")
                            .font(.system(size: 22, weight: .regular))
                            .foregroundStyle(Brand.primary)
                            .frame(width: 34, height: 34)
                    }
                    .accessibilityLabel("Account")
                    .accessibilityHint("Profile, privacy policy, delete account and sign out")
                    Button("Sign Out") { Task { await store.logout() } }
                        .buttonStyle(.outlineSmall)
                        .accessibilityHint("Signs you out of the retailer portal")
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            if signedIn, hSize != .regular, let account = store.account {
                Text("\(account.business_name) · \(account.email)")
                    .font(.caption).foregroundStyle(Brand.muted)
                    .lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.bottom, 10)
            }
        }
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Brand.ink(0.08)).frame(height: 1) }
    }
}

/// Legal / about footer.
struct LegalFooter: View {
    var body: some View {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        VStack(spacing: 2) {
            Text("Ruby FoodHub Retailer \(v) (\(b))")
            Text("© 2026 RUBYNAV INC. This app is a product of RUBYNAV INC.")
        }
        .font(.caption2)
        .foregroundStyle(Brand.ink(0.45))
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }
}
