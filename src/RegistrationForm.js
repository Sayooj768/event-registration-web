import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from './supabaseClient';
import './App.css';

// ── Config ────────────────────────────────────────────────────────────────────
// Put these in your .env file as REACT_APP_SUPABASE_FUNCTION_URL
const SUPABASE_FUNCTION_BASE = process.env.REACT_APP_SUPABASE_FUNCTION_BASE
  ?? 'https://qzfjcmtkojpdbctgggen.supabase.co/functions/v1';

function RegistrationForm() {
    const { id } = useParams();

    const [loading, setLoading]               = useState(true);
    const [error, setError]                   = useState(null);
    const [eventData, setEventData]           = useState(null);
    const [settingsData, setSettingsData]     = useState(null);
    const [participantCount, setParticipantCount] = useState(0);
    const [isFormSubmitted, setIsFormSubmitted]   = useState(false);

    const [fullName, setFullName] = useState('');
    const [email, setEmail]       = useState('');
    const [phone, setPhone]       = useState('');
    const [role, setRole]         = useState('');

    useEffect(() => {
        const fetchEventData = async () => {
            if (!id) return;
            try {
                const { data: eventAndSettingsData, error: settingsError } = await supabase
                    .from('public_registration_settings')
                    .select('*, public_events(*)')
                    .eq('event_id', id)
                    .single();

                if (settingsError) {
                    const { data: eventOnlyData, error: eventError } = await supabase
                        .from('public_events')
                        .select('*')
                        .eq('id', id)
                        .single();
                    if (eventError) throw eventError;
                    setEventData(eventOnlyData);
                    setSettingsData(null);
                } else {
                    setSettingsData(eventAndSettingsData);
                    setEventData(eventAndSettingsData.public_events);
                }

                const { data: count, error: countError } = await supabase
                    .rpc('get_participant_count', { p_event_id: id });
                if (countError) throw countError;
                setParticipantCount(count);

            } catch (err) {
                setError('Sorry, this event could not be found or there was an error.');
            } finally {
                setLoading(false);
            }
        };
        fetchEventData();
    }, [id]);

    // ─────────────────────────────────────────────────────────────────────────
    // saveParticipant → then triggerPayout
    // ─────────────────────────────────────────────────────────────────────────
    const saveParticipant = async (paymentDetails = {}) => {
        try {
            const feeAmount = settingsData?.registration_fee || 0;

            // 1. Insert participant row
            const { data: participant, error: insertErr } = await supabase
                .from('participants')
                .insert({
                    event_id:       id,
                    full_name:      fullName,
                    email:          email,
                    phone:          phone || null,
                    role:           role  || null,
                    payment_id:     paymentDetails.razorpay_payment_id   || null,
                    order_id:       paymentDetails.razorpay_order_id     || null,
                    payment_status: feeAmount > 0 ? 'paid' : 'free',
                    amount_paid:    feeAmount,
                })
                .select('id')   // ← need the new participant ID for the payout call
                .single();

            if (insertErr) throw insertErr;

            // 2. Trigger payout — only for paid registrations
            //    We do NOT await or block the UI on this; fire-and-forget.
            //    If payout fails, the participant is still registered.
            if (feeAmount > 0 && paymentDetails.razorpay_payment_id) {
                triggerPayout({
                    event_id:       id,
                    participant_id: participant.id,
                    amount_paise:   feeAmount,   // already in paise from DB
                });
            }

            setIsFormSubmitted(true);

        } catch (err) {
            setError(
                'Payment might have succeeded, but we could not save your registration. ' +
                'Please contact support.'
            );
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // triggerPayout — calls our new edge function
    // Runs in the background; never blocks the registration success screen.
    // ─────────────────────────────────────────────────────────────────────────
    const triggerPayout = async ({ event_id, participant_id, amount_paise }) => {
        try {
            const res = await fetch(
                `${SUPABASE_FUNCTION_BASE}/process-payout`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ event_id, participant_id, amount_paise }),
                }
            );
            const data = await res.json();

            if (!res.ok) {
                // Log but do NOT show to participant — this is a backend concern
                console.error('[Payout] Failed:', data);
            } else {
                console.log('[Payout] Triggered:', data);
            }
        } catch (err) {
            // Network error — log silently
            console.error('[Payout] Network error:', err);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Initiate payment (unchanged from your original)
    // ─────────────────────────────────────────────────────────────────────────
    const initiatePayment = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const registrationFee = settingsData?.registration_fee;

        if (!registrationFee || registrationFee === 0) {
            await saveParticipant();
            setLoading(false);
            return;
        }

        try {
            const orderResponse = await fetch(
                `${SUPABASE_FUNCTION_BASE}/create-razorpay-order`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ amount: registrationFee }),
                }
            );

            if (!orderResponse.ok) {
                const errorBody = await orderResponse.json();
                throw new Error(errorBody.error || 'Could not create payment order.');
            }
            const orderData = await orderResponse.json();

            const options = {
                key:         process.env.REACT_APP_RAZORPAY_KEY_ID,
                amount:      orderData.amount,
                currency:    orderData.currency,
                name:        eventData.event_title,
                description: 'Event Registration Fee',
                order_id:    orderData.id,
                handler:     function (response) {
                    // Razorpay calls this after successful payment
                    saveParticipant(response);
                },
                prefill: {
                    name:    fullName,
                    email:   email,
                    contact: phone,
                },
                theme: { color: '#3D82F8' },
            };

            const rzp = new window.Razorpay(options);
            rzp.open();

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // UI helpers (unchanged)
    // ─────────────────────────────────────────────────────────────────────────
    const getRegistrationStatus = () => {
        if (!settingsData) return { status: 'OPEN', message: '' };

        const now       = new Date();
        const startDate = settingsData.registration_start_datetime
            ? new Date(settingsData.registration_start_datetime) : null;
        const endDate   = settingsData.registration_end_datetime
            ? new Date(settingsData.registration_end_datetime) : null;

        if (startDate && now < startDate)
            return { status: 'NOT_STARTED', message: `Registration opens on ${startDate.toLocaleDateString()}` };
        if (endDate && now > endDate)
            return { status: 'CLOSED', message: 'Registration for this event has closed.' };
        if (settingsData.max_participants != null && participantCount >= settingsData.max_participants)
            return { status: 'FULL', message: 'Sorry, this event is full.' };

        return { status: 'OPEN', message: '' };
    };

    const renderBody = () => {
        if (isFormSubmitted) {
            return (
                <>
                    <h1>Registration Successful!</h1>
                    <p>{settingsData?.confirmation_message || 'Thank you for registering!'}</p>
                </>
            );
        }

        const registration = getRegistrationStatus();
        if (registration.status !== 'OPEN') {
            return (
                <div>
                    <h3>Registration Information</h3>
                    <p className="status-message">{registration.message}</p>
                </div>
            );
        }

        const fee = settingsData?.registration_fee
            ? (settingsData.registration_fee / 100).toFixed(2)
            : 0;

        return (
            <form onSubmit={initiatePayment}>
                <h3>Register Now {fee > 0 && `(Fee: ₹${fee})`}</h3>

                <div className="form-group">
                    <label>Full Name *</label>
                    <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Enter your full name"
                        required
                    />
                </div>
                <div className="form-group">
                    <label>Email *</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email address"
                        required
                    />
                </div>

                {(settingsData?.required_fields?.includes('Phone') || !settingsData) && (
                    <div className="form-group">
                        <label>Phone</label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Enter your phone number"
                        />
                    </div>
                )}
                {(settingsData?.required_fields?.includes('Role') || !settingsData) && (
                    <div className="form-group">
                        <label>Your Role</label>
                        <input
                            type="text"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="e.g., Student, Professional, etc."
                        />
                    </div>
                )}

                <button type="submit" disabled={loading}>
                    {loading
                        ? 'Processing...'
                        : fee > 0 ? 'Pay & Register' : 'Register for Free'}
                </button>
            </form>
        );
    };

    if (loading)     return <div className="container"><div className="loader"></div></div>;
    if (error)       return <div className="container"><p className="error-message">{error}</p></div>;
    if (!eventData)  return <div className="container"><p>Event not found.</p></div>;

    return (
        <div className="container">
            <header>
                <h1>{eventData.event_title}</h1>
                <p>{eventData.event_description}</p>
            </header>
            <main>
                {renderBody()}
            </main>
        </div>
    );
}

export default RegistrationForm;