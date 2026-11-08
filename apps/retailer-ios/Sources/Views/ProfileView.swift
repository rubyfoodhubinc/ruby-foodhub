import SwiftUI
import PhotosUI
import UIKit

/// #view-profile — business profile, logo upload, Privacy & Account (delete).
struct ProfileView: View {
    @EnvironmentObject var store: PortalStore

    @State private var business = ""
    @State private var contact = ""
    @State private var phone = ""
    @State private var address = ""
    @State private var note = ""
    @State private var saving = false
    @State private var loadedFor: String?

    // Logo
    @State private var showSourceChooser = false
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var pickedItem: PhotosPickerItem?

    // Delete
    @State private var deleteStep1 = false
    @State private var deleteStep2 = false
    @State private var typed = ""
    @State private var deleteNote = ""
    @State private var deleting = false
    @State private var deletedMessage: String?

    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Business Profile")
            logoRow.padding(.bottom, 8)

            FormLabel("Business Name")
            TextField("Business name", text: $business).textContentType(.organizationName).brandField()
            FormLabel("Contact Person")
            TextField("Contact person", text: $contact).textContentType(.name).brandField()
            FormLabel("Account Email (contact us to change)")
            Text(store.account?.email ?? "")
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandField(disabled: true)
                .accessibilityLabel("Account email, \(store.account?.email ?? ""), contact us to change")
            FormLabel("Phone (optional)")
            TextField("Phone (optional)", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad).brandField()
            FormLabel("Business Address (optional)")
            TextField("Business address (optional)", text: $address, axis: .vertical)
                .textContentType(.fullStreetAddress).lineLimit(2...4).brandField()

            Button("Save Profile") { save() }
                .buttonStyle(.pill)
                .disabled(saving)
            if !note.isEmpty { NoteText(note) }

            privacySection
        }
        .card()
        .onAppear(perform: fillIfNeeded)
        .onChange(of: store.account?.id) { _, _ in fillIfNeeded() }
        // Logo source chooser: library always; camera only on devices that have one.
        .confirmationDialog("Upload Company Logo", isPresented: $showSourceChooser, titleVisibility: .visible) {
            Button("Choose from Library") { showLibrary = true }
            if cameraAvailable { Button("Take Photo") { showCamera = true } }
            Button("Cancel", role: .cancel) {}
        }
        .photosPicker(isPresented: $showLibrary, selection: $pickedItem, matching: .images)
        .onChange(of: pickedItem) { _, item in
            guard let item else { return }
            pickedItem = nil
            note = "Processing image…"
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                await process(data.flatMap(UIImage.init(data:)))
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                if let image {
                    note = "Processing image…"
                    Task { await process(image) }
                }
            }
            .ignoresSafeArea()
        }
        // Account deletion — step 1: consequences (same text as the web confirm()).
        .alert("Delete Account", isPresented: $deleteStep1) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) { typed = ""; deleteStep2 = true }
        } message: {
            Text("Permanently delete your Ruby FoodHub wholesale account?\n\n• Your personal details are erased and you are signed out immediately\n• You will not be able to sign in again\n• Past order records are kept for accounting and tax purposes\n• Any unpaid balance is still owed\n\nThis cannot be undone.")
        }
        // Step 2: type DELETE (the same word the API requires).
        .alert("Confirm Deletion", isPresented: $deleteStep2) {
            TextField("DELETE", text: $typed)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Delete My Account", role: .destructive) { performDelete() }
        } message: {
            Text("To confirm, type DELETE below:")
        }
        .alert("Account Deleted", isPresented: Binding(get: { deletedMessage != nil }, set: { if !$0 { deletedMessage = nil } })) {
            Button("OK") { deletedMessage = nil; store.backToAuth() }
        } message: { Text(deletedMessage ?? "") }
        #if DEBUG
        .task {
            if MockServer.argument("-RFHSheet") == "delete" {
                try? await Task.sleep(nanoseconds: 600_000_000)
                deleteStep1 = true
            }
        }
        #endif
    }

    // MARK: - Logo

    private var logoRow: some View {
        HStack(alignment: .center, spacing: 18) {
            if let account = store.account { AccountAvatar(account: account) }
            VStack(alignment: .leading, spacing: 6) {
                Button("Upload Company Logo") { showSourceChooser = true }
                    .buttonStyle(.outlineSmall)
                NoteText("PNG, JPG, or WebP. It's resized automatically and appears across your portal.")
                if let line = statusLine { NoteText(line) }
            }
        }
    }

    private var statusLine: String? {
        guard let a = store.account else { return nil }
        let label = ["active": "Active", "pending": "Pending Approval", "suspended": "Suspended"][a.account_status] ?? a.account_status
        return "Account: " + label + (Fmt.monthYearShort(a.created_at).map { " · Member since " + $0 } ?? "")
    }

    private func process(_ image: UIImage?) async {
        guard let image, let jpeg = LogoImage.jpeg(from: image) else {
            note = "That file could not be read as an image."
            return
        }
        note = "Uploading…"
        note = await store.uploadLogo(jpeg: jpeg)
    }

    // MARK: - Fields

    private func fillIfNeeded() {
        guard let a = store.account, loadedFor != a.id else { return }
        loadedFor = a.id
        business = a.business_name
        contact = a.contact_name ?? ""
        phone = a.phone ?? ""
        address = a.address ?? ""
    }

    private func save() {
        saving = true
        hideKeyboard()
        Task {
            note = await store.saveProfile(business: business, contact: contact, phone: phone, address: address)
            saving = false
        }
    }

    // MARK: - Privacy & Account

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(Brand.ink(0.1)).frame(height: 1).padding(.bottom, 12)
            SectionTitle("Privacy & Account")
            Text(NoticeView.attributed("Read our [**Privacy Policy**](https://www.rubyfoodhub.com/privacy) to see what we store and why."))
                .font(.footnote)
                .foregroundStyle(Brand.ink(0.6))
                .tint(Brand.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)
            Button(deleting ? "Deleting…" : "Delete My Account") { deleteNote = ""; deleteStep1 = true }
                .buttonStyle(.dangerSmall)
                .disabled(deleting)
            NoteText("Permanently deletes your account and personal details (business name, contact, email, phone, address, logo). You will be signed out immediately and cannot sign in again. Past order and payment records are kept as required for accounting and tax, no longer linked to your details. Any unpaid balance remains owed.")
            if !deleteNote.isEmpty { NoteText(deleteNote) }
        }
        .padding(.top, 22)
    }

    private func performDelete() {
        guard typed.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" else {
            deleteNote = "Account not deleted — you must type DELETE exactly."
            return
        }
        deleting = true
        deleteNote = "Deleting your account…"
        Task {
            do {
                let outstanding = try await store.deleteAccount()
                var msg = "Your account has been deleted."
                if outstanding > 0 {
                    msg += "\n\nNote: an outstanding balance of \(Fmt.money(outstanding)) remains owed. Our team will be in touch about settling it."
                }
                msg += "\n\nA confirmation email has been sent to you."
                deletedMessage = msg
            } catch {
                deleteNote = "Could not delete account: " + error.localizedDescription
                deleting = false
            }
        }
    }
}

/// Mirrors the web canvas step: longest side ≤ 512px, JPEG quality 0.85.
enum LogoImage {
    static let maxSide: CGFloat = 512

    static func jpeg(from image: UIImage) -> Data? {
        let w = image.size.width * image.scale, h = image.size.height * image.scale
        guard w > 0, h > 0 else { return nil }
        let scale = min(1, maxSide / max(w, h))
        let target = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: 0.85)
    }
}

/// UIImagePickerController camera, only presented when the camera exists.
struct CameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) { picker.sourceType = .camera }
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}
