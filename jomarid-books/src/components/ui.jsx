import React from 'react';

export const Button = ({ children, variant = 'primary', className = '', ...props }) => {
 const styles = variant === 'secondary' 
   ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }
   : { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };

 if (variant === 'danger') {
   return <button className={`px-4 py-2 rounded-lg font-bold bg-red-600 text-white flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-red-700 transition-all ${className}`} {...props}>{children}</button>;
 }

 return (
   <button style={styles} className={`px-4 py-2 rounded-lg font-bold border transition-all flex items-center justify-center gap-2 text-sm cursor-pointer disabled:opacity-50 ${className}`} {...props}>
     {children}
   </button>
 );
};

export const Card = ({ children, className = '' }) => (
 <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className={`border rounded-xl shadow-xl p-6 transition-all ${className}`}>{children}</div>
);
