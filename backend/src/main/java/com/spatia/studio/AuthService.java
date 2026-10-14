package com.spatia.studio;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AuthService {
    private final Map<String, Account> accounts = new ConcurrentHashMap<>();
    private final Map<String, Account> sessions = new ConcurrentHashMap<>();

    public AuthResponse signup(SignupRequest request) {
        if (accounts.containsKey(request.email().toLowerCase())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "An account with that email already exists");
        }
        Account account = new Account(UUID.randomUUID().toString(), request.email().toLowerCase(), request.password(), request.name());
        accounts.put(account.email(), account);
        return issue(account);
    }

    public AuthResponse login(LoginRequest request) {
        Account account = accounts.get(request.email().toLowerCase());
        if (account == null || !account.password().equals(request.password())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
        return issue(account);
    }

    public Account require(String token) {
        Account account = sessions.get(token);
        if (account == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        return account;
    }

    private AuthResponse issue(Account account) {
        String token = UUID.randomUUID().toString();
        sessions.put(token, account);
        return new AuthResponse(token, new UserView(account.id(), account.email(), account.name()));
    }

    public record Account(String id, String email, String password, String name) {}
}
