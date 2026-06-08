<div align="center">
</div>

# Run and deploy your app

This contains everything you need to run your application locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Configure your environment variables in a file named `.env` in the root folder:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=your_port_here
   JWT_SECRET=your_jwt_secret_here

   # Firebase Configuration (required if firebase-applet-config.json is missing)
   FIREBASE_API_KEY=your_api_key
   FIREBASE_AUTH_DOMAIN=your_auth_domain
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_STORAGE_BUCKET=your_storage_bucket
   FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   FIREBASE_APP_ID=your_app_id
   FIREBASE_MEASUREMENT_ID=your_measurement_id
   FIREBASE_FIRESTORE_DB_ID=(default)

   # Optional: System Dispatch Integrations
   # Create a free account at formspree.io and get your Form ID
   FORMSPREE_FORM_ID=your_formspree_id_here
   
   # SMTP Email Server Configuration
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email_here
   SMTP_PASS=your_app_password_here
   TARGET_NOTIFICATION_EMAIL=your_notification_target_email
   ```
3. Run the app:
   `npm run dev`
