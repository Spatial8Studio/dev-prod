package com.spatia.studio;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AuthService {
    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private final Map<String, Account> accounts = new ConcurrentHashMap<>();
    private final Map<String, Account> sessions = new ConcurrentHashMap<>();

    public AuthService() {
        Account demo = new Account(
            "demo-user",
            "demo@gmail.com",
            "demo@123",
            "Demo User"
        );
        accounts.put(demo.email(), demo);
        log.info("Demo account seeded: email={}", demo.email());
    }

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
        if (token == null || token.isBlank()) {
            log.warn("Authentication failed: missing token");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        Account account = sessions.get(token);
        if (account == null) {
            log.warn("Authentication failed: token is not valid in this backend session (length={})", token.length());
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        log.debug("Authentication succeeded for userId={}", account.id());
        return account;
    }

    public Account accountById(String id) {
        return accounts.values().stream().filter(account -> account.id().equals(id)).findFirst().orElse(null);
    }

    public List<Account> accounts() {
        return List.copyOf(accounts.values());
    }

    private AuthResponse issue(Account account) {
        String token = UUID.randomUUID().toString();
        sessions.put(token, account);
        return new AuthResponse(token, new UserView(account.id(), account.email(), account.name()));
    }

    public record Account(String id, String email, String password, String name) {}
}
