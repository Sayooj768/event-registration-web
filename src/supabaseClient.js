import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://qzfjcmtkojpdbctgggen.supabase.co" // IMPORTANT: Replace with your actual URL
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6ZmpjbXRrb2pwZGJjdGdnZ2VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEwOTI1NDcsImV4cCI6MjA2NjY2ODU0N30.1hqe-l4DmEj_4hSL63Scr7v9lxcSuKwTnfhN46Mso3c" // IMPORTANT: Use the ANON (public) key

export const supabase = createClient(supabaseUrl, supabaseAnonKey)