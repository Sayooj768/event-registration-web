import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from './supabaseClient';
import './App.css';

function RegistrationForm() {
    // Get the event ID from the URL, e.g., /event/123
    const { id } = useParams();

    // State for data loading, errors, and UI control
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [eventData, setEventData] = useState(null);
    const [settingsData, setSettingsData] = useState(null);
    const [participantCount, setParticipantCount] = useState(0);
    const [isFormSubmitted, setIsFormSubmitted] = useState(false);

    // State for the form's input fields
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('');

    // In src/RegistrationForm.js

useEffect(() => {
    const fetchEventData = async () => {
        if (!id) return;
        try {
            // We will now fetch the data in two steps for clarity

            // 1. Fetch the event and its settings
            const { data: eventAndSettingsData, error: settingsError } = await supabase
                .from('registration_settings')
                .select('*, events(*)')
                .eq('event_id', id)
                .single();

            if (settingsError) {
                const { data: eventOnlyData, error: eventError } = await supabase
                    .from('events')
                    .select('*')
                    .eq('id', id)
                    .single();
                if (eventError) throw eventError;
                setEventData(eventOnlyData);
                setSettingsData(null);
            } else {
                setSettingsData(eventAndSettingsData);
                setEventData(eventAndSettingsData.events);
            }

            // 2. Call our new database function to get the participant count securely
            const { data: count, error: countError } = await supabase
                .rpc('get_participant_count', { p_event_id: id });

            if (countError) throw countError;
            setParticipantCount(count);

        } catch (error) {
            setError('Sorry, this event could not be found or there was an error.');
        } finally {
            setLoading(false);
        }
    };

    fetchEventData();
}, [id]);

    // This function is called AFTER a successful payment or for free events
    // AFTER
const saveParticipant = async (paymentDetails = {}) => {
    try {
        // Get the fee from the event settings to store the amount paid
        const feeAmount = settingsData?.registration_fee || 0;

        const { error } = await supabase
            .from('participants')
            .insert({
                // Existing fields
                event_id: id,
                full_name: fullName,
                email: email,
                phone: phone || null,
                role: role || null,

                // NEW: Add the payment details
                payment_id: paymentDetails.razorpay_payment_id,
                order_id: paymentDetails.razorpay_order_id,
                payment_status: 'paid', // Set the status to 'paid'
                amount_paid: feeAmount, // Store the amount that was paid
            });
        if (error) throw error;
        setIsFormSubmitted(true);
    } catch (error) {
        setError('Payment might have succeeded, but we could not save your registration. Please contact support.');
    }
};
    // This function starts the payment process when the form is submitted
    const initiatePayment = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const registrationFee = settingsData?.registration_fee;

        // If the event is free, just save the participant directly
        if (!registrationFee || registrationFee === 0) {
            await saveParticipant();
            setLoading(false);
            return;
        }

        try {
            // 1. Call your Supabase Edge Function to create a Razorpay order
            const orderResponse = await fetch(
                'https://qzfjcmtkojpdbctgggen.supabase.co/functions/v1/create-razorpay-order', // <-- IMPORTANT: Replace
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: registrationFee }),
                }
            );
            
            if (!orderResponse.ok) {
                const errorBody = await orderResponse.json();
                throw new Error(errorBody.error || 'Could not create payment order.');
            }
            const orderData = await orderResponse.json();

            // 2. Open Razorpay Checkout with the order_id from the function
            const options = {
                key: 'rzp_test_RKAMFR3BJ3GzR1', // <-- IMPORTANT: Replace
                amount: orderData.amount,
                currency: orderData.currency,
                name: eventData.event_title,
                description: 'Event Registration Fee',
                order_id: orderData.id,
                handler: function (response) {
                    // This function is called by Razorpay after a successful payment
                    saveParticipant(response);
                },
                prefill: {
                    name: fullName,
                    email: email,
                    contact: phone,
                },
                theme: {
                    color: '#3D82F8',
                },
            };
            const rzp = new window.Razorpay(options);
            rzp.open();

        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Helper function to check the current registration status
    const getRegistrationStatus = () => {
        // If no settings data, allow registration (open by default)
        if (!settingsData) {
            return { status: 'OPEN', message: '' };
        }
        
        const now = new Date();
        const startDate = settingsData.registration_start_datetime ? new Date(settingsData.registration_start_datetime) : null;
        const endDate = settingsData.registration_end_datetime ? new Date(settingsData.registration_end_datetime) : null;
        
        if (startDate && now < startDate) {
            return { status: 'NOT_STARTED', message: `Registration opens on ${startDate.toLocaleDateString()}` };
        }
        if (endDate && now > endDate) {
            return { status: 'CLOSED', message: 'Registration for this event has closed.' };
        }
        if (settingsData.max_participants != null && participantCount >= settingsData.max_participants) {
            return { status: 'FULL', message: 'Sorry, this event is full.' };
        }
        
        return { status: 'OPEN', message: '' };
    };

    // This function decides what to render in the main body
    const renderBody = () => {
        if (isFormSubmitted) {
            return (
                <>
                    <h1>Registration Successful!</h1>
                    <p>{settingsData?.confirmation_message || "Thank you for registering!"}</p>
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
        
        const fee = settingsData.registration_fee ? (settingsData.registration_fee / 100).toFixed(2) : 0;

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

                {/* Show phone field if settings require it OR if no settings (default behavior) */}
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
                {/* Show role field if settings require it OR if no settings (default behavior) */}
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
                    {loading ? 'Processing...' : (fee > 0 ? 'Pay & Register' : 'Register for Free')}
                </button>
            </form>
        );
    };

    // Top-level render logic for the whole component
    if (loading) return <div className="container"><div className="loader"></div></div>;
    if (error) return <div className="container"><p className="error-message">{error}</p></div>;
    if (!eventData) return <div className="container"><p>Event not found.</p></div>;

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