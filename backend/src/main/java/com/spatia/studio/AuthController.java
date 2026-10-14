package com.spatia.studio;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) { this.auth = auth; }
    @PostMapping("/signup") public AuthResponse signup(@Valid @RequestBody SignupRequest request) { return auth.signup(request); }
    @PostMapping("/login") public AuthResponse login(@Valid @RequestBody LoginRequest request) { return auth.login(request); }
    @GetMapping("/me") public UserView me(@RequestHeader("Authorization") String header) {
        return view(auth.require(token(header)));
    }
    static String token(String header) {
        if (header == null || !header.startsWith("Bearer ")) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Authentication required");
        return header.substring(7);
    }
    private UserView view(AuthService.Account a) { return new UserView(a.id(), a.email(), a.name()); }
}
