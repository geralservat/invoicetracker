// Private repo only. The anon key is public-by-design (it ships inside every
// client app); row-level security in Supabase is what protects the data.
// ALSO REQUIRED (one-time, Supabase dashboard):
//   1. Run supabase/03_harden_profiles.sql (blocks privilege escalation).
//   2. Authentication > Providers > Email > disable "Allow new users to sign up".
window.INVOICE_TRACKING_CONFIG = {
  SUPABASE_URL: "https://dcnlsozsjspwmtedpdsd.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbmxzb3pzanNwd210ZWRwZHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4MDYsImV4cCI6MjEwNTQwNDgwNn0.HijvDkud2TGVh0GFzL5_uNx2x7YHK3Pw3nAcOueCVno",
};
