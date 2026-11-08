import SwiftUI

/// #auth-view: Sign In / Apply for Access / Browse Products.
struct AuthScreen: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        VStack(spacing: 0) {
            TopBar(signedIn: false)
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 18) {
                        Text("Retailer Account")
                            .font(.title3.weight(.bold))
                            .accessibilityAddTraits(.isHeader)
                        AuthTabs()
                        switch store.authTab {
                        case .signin: SignInForm()
                        case .apply: ApplyForm()
                        case .browse: BrowseList()
                        }
                        if let err = store.authError {
                            Text(err)
                                .font(.footnote)
                                .foregroundStyle(Brand.primary)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                                .accessibilityLabel("Error: \(err)")
                        }
                        Link("Privacy Policy", destination: Brand.privacyURL)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Brand.primary)
                            .padding(.top, 4)
                    }
                    .padding(28)
                    .frame(maxWidth: 460)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: Brand.ink(0.07), radius: 9, x: 0, y: 6)
                    .padding(.top, 36)
                    .padding(.horizontal, 20)
                    LegalFooter().padding(.top, 14).padding(.horizontal, 20)
                }
                .frame(maxWidth: .infinity)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// .tabs — three equal pill tabs.
struct AuthTabs: View {
    @EnvironmentObject var store: PortalStore
    var body: some View {
        HStack(spacing: 8) {
            ForEach(AuthTab.allCases) { tab in
                let active = store.authTab == tab
                Button { store.selectAuthTab(tab) } label: {
                    Text(tab.title)
                        .font(.subheadline.weight(.bold))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 4)
                        .foregroundStyle(active ? .white : Brand.primary)
                        .background(active ? Brand.primary : .clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(Brand.primary, lineWidth: 1.5))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
        }
    }
}

struct SignInForm: View {
    @EnvironmentObject var store: PortalStore
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @FocusState private var focus: Field?
    enum Field { case email, password }

    var body: some View {
        VStack(spacing: 12) {
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
                .brandField()
            SecureField("Password", text: $password)
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit { submit() }
                .brandField()
            Button(busy ? "Signing In…" : "Sign In") { submit() }
                .buttonStyle(.pillFull)
                .disabled(busy)
        }
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        focus = nil
        Task {
            await store.login(email: email, password: password)
            busy = false
        }
    }
}

struct ApplyForm: View {
    @EnvironmentObject var store: PortalStore
    @State private var business = ""
    @State private var contact = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var address = ""
    @State private var password = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            NoteText("Apply for a wholesale account. Orders unlock once our team approves your application.", alignment: .center)
                .frame(maxWidth: .infinity)
            TextField("Business name", text: $business)
                .textContentType(.organizationName).brandField()
            TextField("Contact person", text: $contact)
                .textContentType(.name).brandField()
            TextField("Business email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .brandField()
            TextField("Phone (optional)", text: $phone)
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
                .brandField()
            TextField("Business address (optional)", text: $address, axis: .vertical)
                .textContentType(.fullStreetAddress)
                .lineLimit(2...4)
                .brandField()
            SecureField("Choose a password (10+ characters)", text: $password)
                .textContentType(.newPassword)
                .brandField()
            Button(busy ? "Submitting…" : "Submit Application") {
                busy = true
                Task {
                    await store.signup(business: business, contact: contact, email: email,
                                       phone: phone, address: address, password: password)
                    busy = false
                }
            }
            .buttonStyle(.pillFull)
            .disabled(busy)
        }
    }
}

/// #browse-form — public catalog, no login, no prices.
struct BrowseList: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NoteText("A look at what Ruby FoodHub carries. Sign in or apply for a wholesale account to see pricing and place orders.", alignment: .center)
                .frame(maxWidth: .infinity)
            if !store.publicCatalogLoaded {
                NoteText("Loading…", alignment: .center).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if let err = store.publicCatalogError {
                EmptyState(err)
            } else if store.publicCatalog.isEmpty {
                EmptyState("No products listed yet — check back soon.")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(store.publicCatalog) { p in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(p.name).font(.body.weight(.bold))
                            if !p.sizes.isEmpty {
                                FlowLayout(spacing: 6, lineSpacing: 6) {
                                    ForEach(p.sizes, id: \.self) { Pill($0, .gray) }
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("Sizes: " + p.sizes.joined(separator: ", "))
                            }
                        }
                        .padding(.vertical, 12).padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Rectangle().fill(Brand.ink(0.08)).frame(height: 1) }
                    }
                }
            }
        }
    }
}
