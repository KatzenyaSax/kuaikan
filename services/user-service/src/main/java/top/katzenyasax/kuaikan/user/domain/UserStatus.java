package top.katzenyasax.kuaikan.user.domain;

/**
 * 账号状态。用数字落库而非 MySQL ENUM：加状态只需改代码，不用 ALTER TABLE。
 */
public enum UserStatus {

    NORMAL(1),
    BANNED(2);

    private final int code;

    UserStatus(int code) {
        this.code = code;
    }

    public int code() {
        return code;
    }

    public static UserStatus of(int code) {
        for (UserStatus s : values()) {
            if (s.code == code) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知账号状态: " + code);
    }
}
