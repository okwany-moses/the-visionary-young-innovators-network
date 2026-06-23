import React, { useState } from "react";
import { User, Mail, Phone, BookOpen, AlertTriangle, CheckCircle, RefreshCcw } from "lucide-react";

interface StatusDetails {
  emailSent: boolean;
  formspreeSent?: boolean;
  emailStatus: string;
}

interface ServerResponse {
  success: boolean;
  message: string;
  details?: {
    registrant: {
      fullName: string;
      email: string;
      phone: string;
      primaryPillar: string;
    };
    delivery: StatusDetails;
  };
  error?: string;
}

const PILLARS = [
  { id: "youth-development", label: "Youth Development & Solution Modules" },
  { id: "lisa-hospitals-support", label: "Lisa Hospitals Support (Healthcare Welfare)" },
  { id: "tree-planting-campaigns", label: "Environmental Protection & Tree Planting Campaigns" },
  { id: "education-funding", label: "Education Funding (Sponsoring School Fees)" },
  { id: "corporate-advertising", label: "Corporate Advertising Space & Brand Integration" }
];

export default function RegistrationForm() {
  const [formData, setFormData] = useState({ fullName: "", email: "", phone: "", primaryPillar: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResponse, setSuccessResponse] = useState<ServerResponse | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.fullName.trim()) errors.fullName = "Full name is required.";
    if (!formData.email.trim()) errors.email = "Email is required.";
    else if (!/\S+@\S+\.\S+/.test(formData.email)) errors.email = "Provide a valid email.";
    if (!formData.phone.trim()) errors.phone = "Phone is required.";
    if (!formData.primaryPillar) errors.primaryPillar = "Select a primary pillar.";
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target as HTMLInputElement;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (validationErrors[name]) setValidationErrors(prev => ({ ...prev, [name]: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessResponse(null);
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data: ServerResponse = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || "Registration failed");
      setSuccessResponse(data);
      setFormData({ fullName: "", email: "", phone: "", primaryPillar: "" });
    } catch (err: any) {
      setErrorMsg(err?.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSuccessResponse(null);
    setErrorMsg(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-slate-900 border border-slate-850 p-6 md:p-8 rounded-sm" id="registration-form-card">
      <div className="text-center mb-8" id="form-header-group">
        <span className="text-[10px] font-mono tracking-widest text-emerald-400 uppercase bg-slate-950 px-3 py-1 border border-emerald-900/40 rounded-sm">Membership Roster</span>
        <h2 className="text-xl md:text-2xl font-display font-light text-slate-100 tracking-tight mt-4">Join the Network</h2>
        <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">Enroll securely as an active co-creator. Settle into permanent developmental taskforces.</p>
      </div>

      {successResponse ? (
        <div className="space-y-6" id="registration-success-container">
          <div className="text-center p-6 bg-emerald-500/5 border border-emerald-500/20 space-y-3 rounded-sm">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto animate-pulse" />
            <h3 className="text-lg font-display font-medium text-emerald-300">Application Filed Successfully</h3>
            <p className="text-xs text-slate-300 leading-relaxed">Welcome to the network, <strong className="text-slate-100">{successResponse.details?.registrant.fullName}</strong>! Your preference details are recorded.</p>
          </div>

          <div className="bg-slate-950 p-5 border border-slate-850 space-y-4 rounded-sm" id="delivery-diagnosis-ledger">
            <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 border-b border-slate-900 pb-2">System Dispatch Details</h4>
            <div className="space-y-3 text-xs font-mono">
              <div className="flex flex-col gap-1 pt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Formspree Inbox Dispatch:</span>
                  <span className={successResponse.details?.delivery.formspreeSent ? "px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-emerald-500/10 text-emerald-400" : "px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-yellow-500/10 text-yellow-500"}>
                    {successResponse.details?.delivery.formspreeSent ? "DISPATCHED" : "SKIPPED"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 italic">{successResponse.details?.delivery.emailStatus}</p>
              </div>
            </div>

            <button onClick={resetForm} id="btn-return-form" className="w-full flex items-center justify-center gap-2 py-3 bg-slate-950 border border-slate-800 text-slate-200 font-medium rounded-sm text-xs uppercase tracking-widest mt-6">
              <RefreshCcw className="w-3.5 h-3.5" /> Register Another Representative
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" id="registration-form" noValidate>
          {errorMsg && (
            <div className="p-4 bg-red-550/10 border border-red-500/25 rounded-sm flex items-start gap-3" id="form-alert-box">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-200">
                <h4 className="font-semibold text-red-400">Submission Blocked</h4>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          <div className="space-y-1.5" id="fullname-field-group">
            <label htmlFor="fullName" className="block text-[10px] font-mono font-medium tracking-wider text-slate-400 uppercase">Full Representative Name <span className="text-emerald-500">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500"><User className="w-3.5 h-3.5" /></div>
              <input type="text" name="fullName" id="fullName" value={formData.fullName} onChange={handleInputChange} placeholder="e.g. Wycliffe Obondo" disabled={isLoading} className={`w-full bg-slate-950 border ${validationErrors.fullName ? "border-red-500" : "border-slate-800"} focus:border-emerald-500 text-slate-200 py-2.5 pl-9 pr-3 outline-none text-xs rounded-sm`} />
            </div>
            {validationErrors.fullName && <p className="text-[10px] text-red-400 font-mono" id="error-fullName">{validationErrors.fullName}</p>}
          </div>

          <div className="space-y-1.5" id="email-field-group">
            <label htmlFor="email" className="block text-[10px] font-mono font-medium tracking-wider text-slate-400 uppercase">Email Address <span className="text-emerald-500">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500"><Mail className="w-3.5 h-3.5" /></div>
              <input type="email" name="email" id="email" value={formData.email} onChange={handleInputChange} placeholder="representative@voicecommedia.com" disabled={isLoading} className={`w-full bg-slate-950 border ${validationErrors.email ? "border-red-500" : "border-slate-800"} focus:border-emerald-500 text-slate-200 py-2.5 pl-9 pr-3 outline-none text-xs rounded-sm`} />
            </div>
            {validationErrors.email && <p className="text-[10px] text-red-400 font-mono" id="error-email">{validationErrors.email}</p>}
          </div>

          <div className="space-y-1.5" id="phone-field-group">
            <label htmlFor="phone" className="block text-[10px] font-mono font-medium tracking-wider text-slate-400 uppercase">International Phone Number <span className="text-emerald-500">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500"><Phone className="w-3.5 h-3.5" /></div>
              <input type="tel" name="phone" id="phone" value={formData.phone} onChange={handleInputChange} placeholder="e.g. +254 700 000 000" disabled={isLoading} className={`w-full bg-slate-950 border ${validationErrors.phone ? "border-red-500" : "border-slate-800"} focus:border-emerald-500 text-slate-200 py-2.5 pl-9 pr-3 outline-none text-xs rounded-sm`} />
            </div>
            {validationErrors.phone && <p className="text-[10px] text-red-400 font-mono" id="error-phone">{validationErrors.phone}</p>}
          </div>

          <div className="space-y-1.5" id="pillar-field-group">
            <label htmlFor="primaryPillar" className="block text-[10px] font-mono font-medium tracking-wider text-slate-400 uppercase">Primary Pillar Focus <span className="text-emerald-500">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500"><BookOpen className="w-3.5 h-3.5" /></div>
              <select name="primaryPillar" id="primaryPillar" value={formData.primaryPillar} onChange={handleInputChange} disabled={isLoading} className={`w-full bg-slate-950 border ${validationErrors.primaryPillar ? "border-red-500" : "border-slate-800"} focus:border-emerald-500 text-slate-200 py-2.5 pl-9 pr-8 outline-none text-xs appearance-none cursor-pointer rounded-sm`}>
                <option value="" className="bg-slate-900 text-slate-500">-- Choose one Active Focus --</option>
                {PILLARS.map(pillar => (
                  <option key={pillar.id} value={pillar.label} className="bg-slate-900 text-slate-200">{pillar.label}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-[9px] text-slate-500">▼</div>
            </div>
            {validationErrors.primaryPillar && <p className="text-[10px] text-red-400 font-mono" id="error-primaryPillar">{validationErrors.primaryPillar}</p>}
          </div>

          <button type="submit" id="register-submit-button" disabled={isLoading} className="w-full relative mt-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded-sm flex items-center justify-center gap-2 border border-emerald-700/20">
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" id="submit-spinner">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Routing System Records...</span>
              </>
            ) : (
              <span>Affiliate Active Membership</span>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
