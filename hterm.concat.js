/*
 * PoC for Repository Hijacking
 * Author: libapps-mirror
 * Purpose: Demonstrate that the hijacked repository is loaded and executed.
 */

alert("Repository Hijacking Successful! Code executed from hijacked repo.");
console.log("%c[PoC] hterm.concat.js loaded from hijacked repository.", "color: red; font-weight: bold;");

document.body.style.backgroundColor = "#fce4ec";
const msg = document.createElement("div");
msg.style.position = "fixed";
msg.style.top = "20px";
msg.style.left = "20px";
msg.style.padding = "10px 20px";
msg.style.background = "#ff1744";
msg.style.color = "#fff";
msg.style.fontSize = "16px";
msg.style.fontFamily = "Arial, sans-serif";
msg.style.borderRadius = "6px";
msg.innerText = "PoC: Script executed from hijacked repository!";
document.body.appendChild(msg);
