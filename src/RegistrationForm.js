import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from './supabaseClient';
import './App.css';

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
                        .from('public_events').select('*').eq('id', id).single();
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

    const saveParticipant = async (paymentDetails = {}) => {
        try {
            const feeAmount = settingsData?.registration_fee || 0;
            const res = await fetch(
                `${SUPABASE_FUNCTION_BASE}/register-and-payout`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_id:            id,
                        full_name:           fullName,
                        email:               email,
                        phone:               phone || null,
                        role:                role  || null,
                        razorpay_payment_id: paymentDetails.razorpay_payment_id || null,
                        razorpay_order_id:   paymentDetails.razorpay_order_id   || null,
                        amount_paise:        feeAmount,
                    }),
                }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registration failed');
            console.log('[Registration] Success:', data);
            setIsFormSubmitted(true);
        } catch (err) {
            setError('Payment might have succeeded, but we could not save your registration. Please contact support.');
            console.error('[Registration] Error:', err);
        }
    };

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
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ amount: registrationFee }) }
            );
            if (!orderResponse.ok) {
                const errorBody = await orderResponse.json();
                throw new Error(errorBody.error || 'Could not create payment order.');
            }
            const orderData = await orderResponse.json();
            const options = {
                key:         'rzp_test_RKAMFR3BJ3GzR1',
                amount:      orderData.amount,
                currency:    orderData.currency,
                name:        eventData.event_title,
                description: 'Event Registration Fee',
                order_id:    orderData.id,
                handler:     function (response) { saveParticipant(response); },
                prefill:     { name: fullName, email: email, contact: phone },
                theme:       { color: '#3D82F8' },
            };
            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getRegistrationStatus = () => {
        if (!settingsData) return { status: 'OPEN', message: '' };
        const now = new Date();
        const startDate = settingsData.registration_start_datetime ? new Date(settingsData.registration_start_datetime) : null;
        const endDate   = settingsData.registration_end_datetime   ? new Date(settingsData.registration_end_datetime)   : null;
        if (startDate && now < startDate) return { status: 'NOT_STARTED', message: `Registration opens on ${startDate.toLocaleDateString()}` };
        if (endDate && now > endDate)     return { status: 'CLOSED',      message: 'Registration for this event has closed.' };
        if (settingsData.max_participants != null && participantCount >= settingsData.max_participants)
            return { status: 'FULL', message: 'Sorry, this event is full.' };
        return { status: 'OPEN', message: '' };
    };

    const renderBody = () => {
        if (isFormSubmitted) {
            return (<><h1>Registration Successful!</h1><p>{settingsData?.confirmation_message || 'Thank you for registering!'}</p></>);
        }
        const registration = getRegistrationStatus();
        if (registration.status !== 'OPEN') {
            return (<div><h3>Registration Information</h3><p className="status-message">{registration.message}</p></div>);
        }
        const fee = settingsData?.registration_fee ? (settingsData.registration_fee / 100).toFixed(2) : 0;
        return (
            <form onSubmit={initiatePayment}>
                <h3>Register Now {fee > 0 && `(Fee: Rs.${fee})`}</h3>
                <div className="form-group">
                    <label>Full Name *</label>
                    <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Enter your full name" required />
                </div>
                <div className="form-group">
                    <label>Email *</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email address" required />
                </div>
                {(settingsData?.required_fields?.includes('Phone') || !settingsData) && (
                    <div className="form-group">
                        <label>Phone</label>
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter your phone number" />
                    </div>
                )}
                {(settingsData?.required_fields?.includes('Role') || !settingsData) && (
                    <div className="form-group">
                        <label>Your Role</label>
                        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g., Student, Professional, etc." />
                    </div>
                )}
                <button type="submit" disabled={loading}>
                    {loading ? 'Processing...' : (fee > 0 ? 'Pay & Register' : 'Register for Free')}
                </button>
            </form>
        );
    };

    if (loading)    return <div className="container"><div className="loader"></div></div>;
    if (error)      return <div className="container"><p className="error-message">{error}</p></div>;
    if (!eventData) return <div className="container"><p>Event not found.</p></div>;

    return (
        <div className="container">
            <header><h1>{eventData.event_title}</h1><p>{eventData.event_description}</p></header>
            <main>{renderBody()}</main>
        </div>
    );
}

export default RegistrationForm;